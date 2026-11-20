import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus, BookingType, PaymentStatus } from '../../common/enums';
import { PaymentsService } from './payments.service';

const userId = new Types.ObjectId();
const otherUserId = new Types.ObjectId();

interface Chain<T> extends PromiseLike<T> {
  lean(): Chain<T>;
  select(): Chain<T>;
  sort(): Chain<T>;
  limit(): Chain<T>;
  session(): Chain<T>;
}

/** A thenable query: every chained method returns itself and awaiting gives `result`. */
function query<T>(result: T): Chain<T> {
  const q: Chain<T> = {
    lean: () => q,
    select: () => q,
    sort: () => q,
    limit: () => q,
    session: () => q,
    then: (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return q;
}

interface BookingRow {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  bookingReference: string;
  status: BookingStatus;
  holdExpiresAt?: Date;
  policySnapshot?: Record<string, unknown>;
  policyAcceptedAt?: Date;
  totalPrice: number;
  currency: string;
}

function makeBooking(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    _id: new Types.ObjectId(),
    user: userId,
    bookingReference: 'ABCD2345',
    status: BookingStatus.PENDING_PAYMENT,
    holdExpiresAt: new Date(Date.now() + 8 * 60_000),
    policySnapshot: { legs: [] },
    policyAcceptedAt: new Date(),
    totalPrice: 123.45,
    currency: 'USD',
    ...overrides,
  };
}

function build({
  flightBookings = [] as BookingRow[],
  hotelBookings = [] as BookingRow[],
  stripeEnabled = true,
} = {}) {
  const intent = {
    id: 'pi_new',
    status: 'requires_payment_method',
    client_secret: 'pi_new_secret_abc',
  };
  const stripe = {
    paymentIntents: {
      create: jest.fn().mockResolvedValue(intent),
      retrieve: jest.fn().mockResolvedValue(intent),
      cancel: jest.fn().mockResolvedValue({ status: 'canceled' }),
    },
  };
  const find = (rows: BookingRow[]) =>
    jest.fn((filter: { _id: Types.ObjectId; user?: Types.ObjectId }) =>
      query(
        rows.find(
          (r) =>
            r._id.equals(filter._id) &&
            (!filter.user || r.user.equals(filter.user)),
        ) ?? null,
      ),
    );
  const bookingModel = (rows: BookingRow[]) => ({
    findOne: find(rows),
    findById: jest.fn((id: Types.ObjectId) =>
      query(rows.find((r) => r._id.equals(id)) ?? null),
    ),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
  });
  const flightBookingModel = bookingModel(flightBookings);
  const hotelBookingModel = bookingModel(hotelBookings);
  const created: { doc?: Record<string, unknown> } = {};
  const paymentModel = {
    findOne: jest.fn((): Chain<unknown> => query<unknown>(null)),
    find: jest.fn((): Chain<unknown> => query<unknown>([])),
    create: jest.fn((doc: Record<string, unknown>) => {
      const saved = {
        _id: new Types.ObjectId(),
        ...doc,
        save: jest.fn().mockResolvedValue(undefined),
      };
      created.doc = saved;
      return Promise.resolve(saved);
    }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    findOneAndUpdate: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string, fallback?: string) =>
      key === 'stripe.secretKey' && stripeEnabled
        ? 'sk_test_x'
        : (fallback ?? ''),
    ),
  };
  const service = new PaymentsService(
    paymentModel as never,
    {} as never,
    flightBookingModel as never,
    hotelBookingModel as never,
    configService as never,
  );
  Object.assign(service, { stripe: stripeEnabled ? stripe : null });
  return {
    service,
    stripe,
    paymentModel,
    flightBookingModel,
    hotelBookingModel,
    created,
    intent,
  };
}

describe('PaymentsService.createPayment', () => {
  it('creates the intent for the booking total stored on the server', async () => {
    const booking = makeBooking();
    const { service, stripe, paymentModel, flightBookingModel, created } =
      build({
        flightBookings: [booking],
      });

    const result = await service.createPayment(userId.toString(), {
      bookingType: BookingType.FLIGHT,
      bookingId: booking._id.toString(),
    });

    const [params, options] = stripe.paymentIntents.create.mock.calls[0] as [
      Record<string, unknown>,
      { idempotencyKey: string },
    ];
    expect(params.amount).toBe(12345);
    expect(params.currency).toBe('usd');
    expect(params.metadata).toMatchObject({
      bookingType: 'flight',
      bookingId: booking._id.toString(),
      userId: userId.toString(),
    });
    expect(options.idempotencyKey).toMatch(/^payment-[0-9a-f]{24}-1$/);
    expect(paymentModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.any(Types.ObjectId) as unknown,
        flightBooking: booking._id,
        amount: 123.45,
        currency: 'USD',
        status: PaymentStatus.PENDING,
        policyAcceptedAt: booking.policyAcceptedAt,
        holdExpiresAt: booking.holdExpiresAt,
      }),
    );
    expect(created.doc?.stripePaymentIntentId).toBe('pi_new');
    expect(result).toMatchObject({
      clientSecret: 'pi_new_secret_abc',
      stripePaymentIntentId: 'pi_new',
      status: PaymentStatus.PENDING,
      amount: 123.45,
      currency: 'USD',
      bookingType: BookingType.FLIGHT,
      bookingId: booking._id.toString(),
      holdExpiresAt: booking.holdExpiresAt,
    });
    // the booking only gets linked to the payment, never confirmed
    const [filter, update] = flightBookingModel.updateOne.mock.calls[0] as [
      { status: BookingStatus },
      { $set: Record<string, unknown> },
    ];
    expect(filter.status).toBe(BookingStatus.PENDING_PAYMENT);
    expect(Object.keys(update.$set)).toEqual(['payment']);
  });

  it('never stores or returns anything but the client secret from Stripe', async () => {
    const booking = makeBooking();
    const { service, paymentModel } = build({ flightBookings: [booking] });

    await service.createPayment(userId.toString(), {
      bookingType: BookingType.FLIGHT,
      bookingId: booking._id.toString(),
    });

    const stored = paymentModel.create.mock.calls[0][0];
    expect(JSON.stringify(stored)).not.toContain('pi_new_secret_abc');
    expect(stored).not.toHaveProperty('stripeClientSecret');
  });

  it('pays a hotel reservation through the hotel collection', async () => {
    const booking = makeBooking();
    const { service, paymentModel, hotelBookingModel, flightBookingModel } =
      build({ hotelBookings: [booking] });

    await service.createPayment(userId.toString(), {
      bookingType: BookingType.HOTEL,
      bookingId: booking._id.toString(),
    });

    expect(paymentModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ hotelBooking: booking._id }),
    );
    expect(hotelBookingModel.updateOne).toHaveBeenCalledTimes(1);
    expect(flightBookingModel.updateOne).not.toHaveBeenCalled();
  });

  it("treats another user's booking and a malformed id as not found", async () => {
    const booking = makeBooking();
    const { service, stripe } = build({ flightBookings: [booking] });

    await expect(
      service.createPayment(otherUserId.toString(), {
        bookingType: BookingType.FLIGHT,
        bookingId: booking._id.toString(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.createPayment(userId.toString(), {
        bookingType: BookingType.FLIGHT,
        bookingId: 'nope',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it.each([
    BookingStatus.CONFIRMED,
    BookingStatus.CANCELLED,
    BookingStatus.EXPIRED,
    BookingStatus.COMPLETED,
  ])('refuses a %s booking', async (status) => {
    const booking = makeBooking({ status });
    const { service, stripe } = build({ flightBookings: [booking] });

    await expect(
      service.createPayment(userId.toString(), {
        bookingType: BookingType.FLIGHT,
        bookingId: booking._id.toString(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('refuses when the hold has expired', async () => {
    const booking = makeBooking({ holdExpiresAt: new Date(Date.now() - 1) });
    const { service, stripe } = build({ flightBookings: [booking] });

    await expect(
      service.createPayment(userId.toString(), {
        bookingType: BookingType.FLIGHT,
        bookingId: booking._id.toString(),
      }),
    ).rejects.toThrow(/hold has expired/);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('is blocked until the policies were accepted', async () => {
    const booking = makeBooking({ policyAcceptedAt: undefined });
    const { service, stripe, paymentModel } = build({
      flightBookings: [booking],
    });

    await expect(
      service.createPayment(userId.toString(), {
        bookingType: BookingType.FLIGHT,
        bookingId: booking._id.toString(),
      }),
    ).rejects.toThrow(/Accept the booking policies/);
    expect(paymentModel.create).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('needs the booking details (policies snapshot) first', async () => {
    const booking = makeBooking({ policySnapshot: undefined });
    const { service } = build({ flightBookings: [booking] });

    await expect(
      service.createPayment(userId.toString(), {
        bookingType: BookingType.FLIGHT,
        bookingId: booking._id.toString(),
      }),
    ).rejects.toThrow(/booking details/);
  });

  it('points to retry when a payment already exists for the booking', async () => {
    const booking = makeBooking();
    const { service, paymentModel, stripe } = build({
      flightBookings: [booking],
    });
    const existingId = new Types.ObjectId();
    paymentModel.findOne.mockReturnValue(
      query({ _id: existingId, status: PaymentStatus.FAILED }),
    );

    await expect(
      service.createPayment(userId.toString(), {
        bookingType: BookingType.FLIGHT,
        bookingId: booking._id.toString(),
      }),
    ).rejects.toThrow(new RegExp(`/payments/${existingId.toString()}/retry`));
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('says so when the booking is already paid', async () => {
    const booking = makeBooking();
    const { service, paymentModel } = build({ flightBookings: [booking] });
    paymentModel.findOne.mockReturnValue(
      query({ _id: new Types.ObjectId(), status: PaymentStatus.SUCCEEDED }),
    );

    await expect(
      service.createPayment(userId.toString(), {
        bookingType: BookingType.FLIGHT,
        bookingId: booking._id.toString(),
      }),
    ).rejects.toThrow(/already paid/);
  });

  it('turns a concurrent duplicate (unique index) into a 409', async () => {
    const booking = makeBooking();
    const { service, paymentModel, stripe } = build({
      flightBookings: [booking],
    });
    paymentModel.create.mockRejectedValue({ code: 11000 });

    await expect(
      service.createPayment(userId.toString(), {
        bookingType: BookingType.FLIGHT,
        bookingId: booking._id.toString(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('removes the payment record and returns 400 when Stripe rejects the request', async () => {
    const booking = makeBooking();
    const { service, stripe, paymentModel } = build({
      flightBookings: [booking],
    });
    stripe.paymentIntents.create.mockRejectedValue({
      type: 'StripeInvalidRequestError',
      message: 'Invalid currency',
    });

    await expect(
      service.createPayment(userId.toString(), {
        bookingType: BookingType.FLIGHT,
        bookingId: booking._id.toString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(paymentModel.deleteOne).toHaveBeenCalledTimes(1);
  });

  it('returns 503 and leaves no payment behind when Stripe is down', async () => {
    const booking = makeBooking();
    const { service, stripe, paymentModel } = build({
      flightBookings: [booking],
    });
    stripe.paymentIntents.create.mockRejectedValue(
      new Error('connection reset'),
    );

    await expect(
      service.createPayment(userId.toString(), {
        bookingType: BookingType.FLIGHT,
        bookingId: booking._id.toString(),
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(paymentModel.deleteOne).toHaveBeenCalledTimes(1);
  });

  it('is a 503 when Stripe is not configured', async () => {
    const booking = makeBooking();
    const { service } = build({
      flightBookings: [booking],
      stripeEnabled: false,
    });

    await expect(
      service.createPayment(userId.toString(), {
        bookingType: BookingType.FLIGHT,
        bookingId: booking._id.toString(),
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('cancels the intent and the payment when the booking stopped being payable meanwhile', async () => {
    const booking = makeBooking();
    const { service, stripe, flightBookingModel, paymentModel } = build({
      flightBookings: [booking],
    });
    flightBookingModel.updateOne.mockResolvedValue({ matchedCount: 0 });

    await expect(
      service.createPayment(userId.toString(), {
        bookingType: BookingType.FLIGHT,
        bookingId: booking._id.toString(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_new');
    expect(paymentModel.updateOne).toHaveBeenCalledWith(expect.anything(), {
      $set: { status: PaymentStatus.CANCELLED },
    });
  });
});
