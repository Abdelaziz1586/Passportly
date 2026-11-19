import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import Stripe from 'stripe';
import {
  BookingStatus,
  BookingType,
  NotificationType,
  PaymentStatus,
} from '../../common/enums';
import { PaymentWebhookService } from './payment-webhook.service';

const SECRET = 'whsec_test_secret_for_unit_tests';
const stripe = new Stripe('sk_test_dummy');

function sign(payload: string, secret = SECRET): string {
  return stripe.webhooks.generateTestHeaderString({ payload, secret });
}

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

const userId = new Types.ObjectId();

function makeFlightBooking(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    user: userId,
    bookingReference: 'ABCD2345',
    status: BookingStatus.PENDING_PAYMENT,
    passengers: [{}, {}],
    passengerCounts: { totalSeatsRequired: 2 },
    legs: [{ cabin: new Types.ObjectId() }, { cabin: new Types.ObjectId() }],
    ...overrides,
  };
}

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    user: userId,
    bookingType: BookingType.FLIGHT,
    flightBooking: new Types.ObjectId(),
    amount: 250.5,
    currency: 'USD',
    status: PaymentStatus.PENDING,
    stripePaymentIntentId: 'pi_123',
    ...overrides,
  };
}

function intentEvent(
  type: string,
  overrides: Record<string, unknown> = {},
): Stripe.Event {
  return {
    id: 'evt_1',
    type,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'pi_123',
        amount_received: 25050,
        currency: 'usd',
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

function build() {
  const paymentModel = {
    findOne: jest.fn(),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const flightBookingModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const hotelBookingModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const refundModel = {
    findOne: jest.fn(() => query<unknown>(null)),
    create: jest.fn((doc: Record<string, unknown>) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...doc }),
    ),
  };
  const cabinModel = {
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const roomAvailabilityModel = {
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const notificationsService = {
    createNotification: jest.fn().mockResolvedValue({}),
  };
  const session = { id: 'session' };
  const connection = {
    transaction: jest.fn((cb: (s: unknown) => Promise<unknown>) => cb(session)),
  };
  const configService = {
    get: jest.fn((key: string, fallback?: string) =>
      key === 'stripe.webhookSecret' ? SECRET : (fallback ?? ''),
    ),
  };
  const paymentsService = {
    stripe: stripe as unknown,
    paymentModel,
    refundModel,
    flightBookingModel,
    hotelBookingModel,
  };
  const service = new PaymentWebhookService(
    paymentsService as never,
    configService as never,
    notificationsService as never,
    cabinModel as never,
    roomAvailabilityModel as never,
    connection as never,
  );
  return {
    service,
    paymentModel,
    refundModel,
    flightBookingModel,
    hotelBookingModel,
    cabinModel,
    roomAvailabilityModel,
    notificationsService,
    connection,
    configService,
    paymentsService,
  };
}

describe('PaymentWebhookService.verifyEvent', () => {
  const body = JSON.stringify({
    id: 'evt_1',
    object: 'event',
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_123' } },
  });

  it('accepts a correctly signed raw body', () => {
    const { service } = build();

    const event = service.verifyEvent(Buffer.from(body), sign(body));

    expect(event.id).toBe('evt_1');
    expect(event.type).toBe('payment_intent.succeeded');
  });

  it('rejects a body signed with another secret', () => {
    const { service } = build();

    expect(() =>
      service.verifyEvent(Buffer.from(body), sign(body, 'whsec_someone_else')),
    ).toThrow(new BadRequestException('Invalid Stripe signature'));
  });

  it('rejects a body changed after signing', () => {
    const { service } = build();

    expect(() =>
      service.verifyEvent(
        Buffer.from(body.replace('pi_123', 'pi_999')),
        sign(body),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects a missing signature header and a missing raw body', () => {
    const { service } = build();

    expect(() => service.verifyEvent(Buffer.from(body), undefined)).toThrow(
      /Missing stripe-signature/,
    );
    expect(() => service.verifyEvent(undefined, sign(body))).toThrow(
      /Missing raw request body/,
    );
  });

  it('is a 503 when the webhook secret or Stripe is not configured', () => {
    const noSecret = build();
    noSecret.configService.get.mockReturnValue('');
    expect(() =>
      noSecret.service.verifyEvent(Buffer.from(body), sign(body)),
    ).toThrow(ServiceUnavailableException);

    const noStripe = build();
    Object.assign(noStripe.paymentsService, { stripe: null });
    expect(() =>
      noStripe.service.verifyEvent(Buffer.from(body), sign(body)),
    ).toThrow(ServiceUnavailableException);
  });
});

describe('PaymentWebhookService payment_intent.succeeded', () => {
  function setupFlight(
    bookingOverrides: Record<string, unknown> = {},
    paymentOverrides: Record<string, unknown> = {},
  ) {
    const ctx = build();
    const payment = makePayment(paymentOverrides);
    const booking = makeFlightBooking(bookingOverrides);
    ctx.paymentModel.findOne.mockReturnValue(query(payment));
    ctx.paymentModel.findOneAndUpdate.mockResolvedValue({
      ...payment,
      status: PaymentStatus.SUCCEEDED,
    });
    ctx.flightBookingModel.findOne.mockReturnValue(query(booking));
    ctx.flightBookingModel.findOneAndUpdate.mockResolvedValue({
      ...booking,
      status: BookingStatus.CONFIRMED,
    });
    return { ...ctx, payment, booking };
  }

  it('confirms the booking, books the held seats, issues e-ticket numbers and notifies', async () => {
    const {
      service,
      paymentModel,
      flightBookingModel,
      cabinModel,
      notificationsService,
      booking,
      connection,
    } = setupFlight();

    const result = await service.handleEvent(
      intentEvent('payment_intent.succeeded'),
    );

    expect(result).toEqual({ received: true, outcome: 'confirmed' });
    expect(connection.transaction).toHaveBeenCalledTimes(1);

    // payment -> SUCCEEDED, guarded so a replay does nothing
    const [payFilter, payUpdate] = paymentModel.findOneAndUpdate.mock
      .calls[0] as [
      { status: { $in: PaymentStatus[] } },
      { $set: { status: PaymentStatus; paidAt: Date } },
    ];
    expect(payFilter.status.$in).not.toContain(PaymentStatus.SUCCEEDED);
    expect(payUpdate.$set.status).toBe(PaymentStatus.SUCCEEDED);
    expect(payUpdate.$set.paidAt).toBeInstanceOf(Date);

    // booking: only from PENDING_PAYMENT, becomes CONFIRMED with e-ticket numbers
    const [bookFilter, bookUpdate] = flightBookingModel.findOneAndUpdate.mock
      .calls[0] as [
      { status: BookingStatus },
      { $set: Record<string, unknown> },
    ];
    expect(bookFilter.status).toBe(BookingStatus.PENDING_PAYMENT);
    expect(bookUpdate.$set.status).toBe(BookingStatus.CONFIRMED);
    expect(bookUpdate.$set['passengers.0.eTicketNumber']).toBe('ETKABCD234501');
    expect(bookUpdate.$set['passengers.1.eTicketNumber']).toBe('ETKABCD234502');

    // held seats become booked on every leg (availableSeats already dropped at hold time)
    expect(cabinModel.updateOne).toHaveBeenCalledTimes(2);
    for (const [filter, update] of cabinModel.updateOne.mock.calls as [
      { heldSeats: { $gte: number } },
      { $inc: Record<string, number> },
    ][]) {
      expect(filter.heldSeats.$gte).toBe(2);
      expect(update.$inc).toEqual({ heldSeats: -2 });
    }

    const types = notificationsService.createNotification.mock.calls.map(
      ([n]: [{ type: NotificationType }]) => n.type,
    );
    expect(types).toEqual([
      NotificationType.PAYMENT_SUCCEEDED,
      NotificationType.BOOKING_CONFIRMED,
    ]);
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: booking.user,
        relatedEntityType: 'FlightBooking',
      }),
    );
  });

  it('is idempotent: a replayed event changes nothing and notifies nobody', async () => {
    const {
      service,
      paymentModel,
      flightBookingModel,
      cabinModel,
      notificationsService,
    } = setupFlight();
    paymentModel.findOneAndUpdate.mockResolvedValue(null); // already SUCCEEDED

    const result = await service.handleEvent(
      intentEvent('payment_intent.succeeded'),
    );

    expect(result.outcome).toBe('duplicate');
    expect(flightBookingModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(cabinModel.updateOne).not.toHaveBeenCalled();
    expect(notificationsService.createNotification).not.toHaveBeenCalled();
  });

  it('does not confirm when the paid amount differs from the booking total', async () => {
    const { service, paymentModel, flightBookingModel, connection } =
      setupFlight();

    const result = await service.handleEvent(
      intentEvent('payment_intent.succeeded', { amount_received: 100 }),
    );

    expect(result.outcome).toBe('amount_mismatch');
    expect(connection.transaction).not.toHaveBeenCalled();
    expect(flightBookingModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(paymentModel.updateOne).toHaveBeenCalledWith(expect.anything(), {
      $set: expect.objectContaining({
        status: PaymentStatus.FAILED,
      }) as unknown,
    });
  });

  it('does not confirm when the paid currency differs', async () => {
    const { service, connection } = setupFlight();

    const result = await service.handleEvent(
      intentEvent('payment_intent.succeeded', { currency: 'eur' }),
    );

    expect(result.outcome).toBe('amount_mismatch');
    expect(connection.transaction).not.toHaveBeenCalled();
  });

  it('ignores an intent that has no payment record', async () => {
    const { service, paymentModel, connection } = build();
    paymentModel.findOne.mockReturnValue(query(null));

    const result = await service.handleEvent(
      intentEvent('payment_intent.succeeded'),
    );

    expect(result.outcome).toBe('unknown_payment');
    expect(connection.transaction).not.toHaveBeenCalled();
  });

  describe('payment after the booking could no longer be confirmed', () => {
    function setupOrphan() {
      const ctx = setupFlight();
      ctx.flightBookingModel.findOne.mockReturnValue(query(null)); // expired meanwhile
      const refunds = {
        create: jest
          .fn()
          .mockResolvedValue({ id: 're_1', status: 'succeeded' }),
      };
      Object.assign(ctx.paymentsService, { stripe: { refunds } });
      // what ensureOrphanRefund reads back after the transaction flagged the payment
      ctx.paymentModel.findById.mockReturnValue(
        query({
          ...ctx.payment,
          metadata: { needsRefund: true },
        }),
      );
      return { ...ctx, refunds };
    }

    it('does not confirm, refunds in full through the Stripe Refunds API, records it and tells the user', async () => {
      const {
        service,
        paymentModel,
        flightBookingModel,
        cabinModel,
        notificationsService,
        refundModel,
        refunds,
        payment,
      } = setupOrphan();

      const result = await service.handleEvent(
        intentEvent('payment_intent.succeeded'),
      );

      expect(result.outcome).toBe('orphaned');
      expect(flightBookingModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(cabinModel.updateOne).not.toHaveBeenCalled();
      expect(paymentModel.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        { $set: { 'metadata.needsRefund': true } },
        expect.anything(),
      );
      expect(refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({ payment_intent: 'pi_123' }),
        { idempotencyKey: `orphan-refund-${payment._id.toString()}` },
      );
      expect(refundModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          payment: payment._id,
          user: userId,
          amount: 250.5,
          currency: 'USD',
          stripeRefundId: 're_1',
          status: 'SUCCEEDED',
        }),
      );
      expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationType.REFUND_PROCESSED }),
      );
      // the refund is remembered on the payment so a retried event never refunds twice
      expect(paymentModel.updateOne).toHaveBeenCalledWith(
        { _id: payment._id },
        { $set: { 'metadata.orphanRefundId': expect.any(String) as unknown } },
      );
    });

    it('lets Stripe retry the event when the refund call fails', async () => {
      const { service, refunds } = setupOrphan();
      refunds.create.mockRejectedValue(new Error('stripe down'));

      await expect(
        service.handleEvent(intentEvent('payment_intent.succeeded')),
      ).rejects.toThrow('stripe down');
    });

    it('a retried event finishes a refund that never completed, but never refunds twice', async () => {
      const retry = setupOrphan();
      retry.paymentModel.findOne.mockReturnValue(
        query({ ...retry.payment, metadata: { needsRefund: true } }),
      );
      retry.paymentModel.findOneAndUpdate.mockResolvedValue(null); // already SUCCEEDED

      const result = await retry.service.handleEvent(
        intentEvent('payment_intent.succeeded'),
      );
      expect(result.outcome).toBe('duplicate');
      expect(retry.refunds.create).toHaveBeenCalledTimes(1);

      const done = setupOrphan();
      done.paymentModel.findOne.mockReturnValue(
        query({ ...done.payment, metadata: { needsRefund: true } }),
      );
      done.paymentModel.findOneAndUpdate.mockResolvedValue(null);
      done.paymentModel.findById.mockReturnValue(
        query({
          ...done.payment,
          metadata: { needsRefund: true, orphanRefundId: 'abc' },
        }),
      );
      await done.service.handleEvent(intentEvent('payment_intent.succeeded'));
      expect(done.refunds.create).not.toHaveBeenCalled();
    });

    it('records a pending Stripe refund as PENDING', async () => {
      const { service, refunds, refundModel } = setupOrphan();
      refunds.create.mockResolvedValue({ id: 're_2', status: 'pending' });

      await service.handleEvent(intentEvent('payment_intent.succeeded'));

      expect(refundModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PENDING', processedAt: undefined }),
      );
    });
  });

  it('only confirms a booking whose hold had not ended when the payment completed', async () => {
    const { service, flightBookingModel } = setupFlight();
    const paidAtSeconds = 1_800_000_000;

    await service.handleEvent({
      ...intentEvent('payment_intent.succeeded'),
      created: paidAtSeconds,
    });

    const [filter] = flightBookingModel.findOne.mock.calls[0] as [
      { holdExpiresAt: { $gte: Date } },
    ];
    expect(filter.holdExpiresAt.$gte).toEqual(new Date(paidAtSeconds * 1000));
  });

  it('only confirms the booking that is linked to this payment', async () => {
    const { service, flightBookingModel, payment } = setupFlight();

    await service.handleEvent(intentEvent('payment_intent.succeeded'));

    const [filter] = flightBookingModel.findOne.mock.calls[0] as [
      { _id: Types.ObjectId; status: BookingStatus; payment: Types.ObjectId },
    ];
    expect(filter._id).toBe(payment.flightBooking);
    expect(filter.payment).toBe(payment._id);
    expect(filter.status).toBe(BookingStatus.PENDING_PAYMENT);
  });

  it('survives a failing notification service', async () => {
    const { service, notificationsService } = setupFlight();
    notificationsService.createNotification.mockRejectedValue(
      new Error('db down'),
    );

    const result = await service.handleEvent(
      intentEvent('payment_intent.succeeded'),
    );

    expect(result.outcome).toBe('confirmed');
  });

  it('confirms a hotel reservation and turns held units into booked units for every room and night', async () => {
    const ctx = build();
    const roomA = new Types.ObjectId();
    const roomB = new Types.ObjectId();
    const hotelBookingId = new Types.ObjectId();
    const payment = makePayment({
      bookingType: BookingType.HOTEL,
      flightBooking: null,
      hotelBooking: hotelBookingId,
    });
    const booking = {
      _id: hotelBookingId,
      user: userId,
      bookingReference: 'HOTEL123',
      status: BookingStatus.PENDING_PAYMENT,
      checkInDate: new Date('2026-12-10T00:00:00.000Z'),
      nights: 3,
      rooms: [
        { room: roomA, quantity: 1 },
        { room: roomB, quantity: 2 },
      ],
    };
    ctx.paymentModel.findOne.mockReturnValue(query(payment));
    ctx.paymentModel.findOneAndUpdate.mockResolvedValue({
      ...payment,
      status: PaymentStatus.SUCCEEDED,
    });
    ctx.hotelBookingModel.findOne.mockReturnValue(query(booking));
    ctx.hotelBookingModel.findOneAndUpdate.mockResolvedValue({
      ...booking,
      status: BookingStatus.CONFIRMED,
    });

    const result = await ctx.service.handleEvent(
      intentEvent('payment_intent.succeeded'),
    );

    expect(result.outcome).toBe('confirmed');
    expect(ctx.flightBookingModel.findOne).not.toHaveBeenCalled();
    const calls = ctx.roomAvailabilityModel.updateOne.mock.calls as [
      { room: Types.ObjectId; date: Date; heldUnits: { $gte: number } },
      { $inc: { heldUnits: number; bookedUnits: number } },
    ][];
    expect(calls).toHaveLength(6); // 2 rooms x 3 nights
    expect(calls.map(([f]) => f.date.toISOString()).slice(0, 3)).toEqual([
      '2026-12-10T00:00:00.000Z',
      '2026-12-11T00:00:00.000Z',
      '2026-12-12T00:00:00.000Z',
    ]);
    const forB = calls.filter(([f]) => f.room.equals(roomB));
    expect(
      forB.every(
        ([, u]) => u.$inc.heldUnits === -2 && u.$inc.bookedUnits === 2,
      ),
    ).toBe(true);
    expect(ctx.notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ relatedEntityType: 'HotelBooking' }),
    );
  });
});

describe('PaymentWebhookService other events', () => {
  it('payment_failed marks FAILED with the reason, keeps the booking and notifies once', async () => {
    const { service, paymentModel, notificationsService, flightBookingModel } =
      build();
    const payment = makePayment({ status: PaymentStatus.FAILED });
    paymentModel.findOneAndUpdate.mockResolvedValue(payment);

    const result = await service.handleEvent(
      intentEvent('payment_intent.payment_failed', {
        last_payment_error: { message: 'Your card was declined.' },
      }),
    );

    expect(result.outcome).toBe('failed');
    const [filter, update] = paymentModel.findOneAndUpdate.mock.calls[0] as [
      { status: { $in: PaymentStatus[] } },
      { $set: { status: PaymentStatus; failureReason: string } },
    ];
    expect(filter.status.$in).toEqual([
      PaymentStatus.PENDING,
      PaymentStatus.PROCESSING,
    ]);
    expect(update.$set).toEqual({
      status: PaymentStatus.FAILED,
      failureReason: 'Your card was declined.',
    });
    expect(flightBookingModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.PAYMENT_FAILED,
        recipient: userId,
      }),
    );
  });

  it('a replayed payment_failed (already FAILED or SUCCEEDED) changes and notifies nothing', async () => {
    const { service, paymentModel, notificationsService } = build();
    paymentModel.findOneAndUpdate.mockResolvedValue(null);

    const result = await service.handleEvent(
      intentEvent('payment_intent.payment_failed'),
    );

    expect(result.outcome).toBe('ignored');
    expect(notificationsService.createNotification).not.toHaveBeenCalled();
  });

  it('truncates an overlong failure reason', async () => {
    const { service, paymentModel } = build();
    paymentModel.findOneAndUpdate.mockResolvedValue(makePayment());

    await service.handleEvent(
      intentEvent('payment_intent.payment_failed', {
        last_payment_error: { message: 'x'.repeat(1000) },
      }),
    );

    const [, update] = paymentModel.findOneAndUpdate.mock.calls[0] as [
      unknown,
      { $set: { failureReason: string } },
    ];
    expect(update.$set.failureReason).toHaveLength(300);
  });

  it('canceled moves an open payment to CANCELLED and ignores a replay', async () => {
    const { service, paymentModel } = build();
    paymentModel.findOne.mockReturnValue(query({ holdExpiresAt: undefined }));

    expect(
      (await service.handleEvent(intentEvent('payment_intent.canceled')))
        .outcome,
    ).toBe('cancelled');
    const [filter, update] = paymentModel.updateOne.mock.calls[0] as [
      { status: { $in: PaymentStatus[] } },
      { $set: { status: PaymentStatus } },
    ];
    expect(filter.status.$in).not.toContain(PaymentStatus.SUCCEEDED);
    expect(update.$set.status).toBe(PaymentStatus.CANCELLED);

    paymentModel.updateOne.mockResolvedValue({ modifiedCount: 0 });
    expect(
      (await service.handleEvent(intentEvent('payment_intent.canceled')))
        .outcome,
    ).toBe('ignored');
  });

  it('canceled after the hold ended is EXPIRED (whoever cancelled first)', async () => {
    const { service, paymentModel } = build();
    paymentModel.findOne.mockReturnValue(
      query({ holdExpiresAt: new Date(Date.now() - 5000) }),
    );

    await service.handleEvent(intentEvent('payment_intent.canceled'));

    const [, update] = paymentModel.updateOne.mock.calls[0] as [
      unknown,
      { $set: { status: PaymentStatus } },
    ];
    expect(update.$set.status).toBe(PaymentStatus.EXPIRED);
  });

  it('canceled for an unknown intent is ignored', async () => {
    const { service, paymentModel } = build();
    paymentModel.findOne.mockReturnValue(query(null));

    expect(
      (await service.handleEvent(intentEvent('payment_intent.canceled')))
        .outcome,
    ).toBe('ignored');
    expect(paymentModel.updateOne).not.toHaveBeenCalled();
  });

  it('processing moves a PENDING payment to PROCESSING and ignores a replay', async () => {
    const { service, paymentModel } = build();

    expect(
      (await service.handleEvent(intentEvent('payment_intent.processing')))
        .outcome,
    ).toBe('processing');
    const [filter, update] = paymentModel.updateOne.mock.calls[0] as [
      { status: PaymentStatus },
      { $set: { status: PaymentStatus } },
    ];
    expect(filter.status).toBe(PaymentStatus.PENDING);
    expect(update.$set.status).toBe(PaymentStatus.PROCESSING);

    paymentModel.updateOne.mockResolvedValue({ modifiedCount: 0 });
    expect(
      (await service.handleEvent(intentEvent('payment_intent.processing')))
        .outcome,
    ).toBe('ignored');
  });

  it('charge.refunded marks REFUNDED for a full refund and PARTIALLY_REFUNDED otherwise', async () => {
    const { service, paymentModel } = build();
    const charge = (refunded: number) =>
      ({
        id: 'evt_2',
        type: 'charge.refunded',
        data: {
          object: {
            payment_intent: 'pi_123',
            amount: 25050,
            amount_refunded: refunded,
          },
        },
      }) as unknown as Stripe.Event;

    await service.handleEvent(charge(25050));
    await service.handleEvent(charge(5000));

    const statuses = paymentModel.updateOne.mock.calls.map(
      ([, u]: [unknown, { $set: { status: PaymentStatus } }]) => u.$set.status,
    );
    expect(statuses).toEqual([
      PaymentStatus.REFUNDED,
      PaymentStatus.PARTIALLY_REFUNDED,
    ]);
  });

  it('charge.refunded without a payment intent, and unknown event types, are ignored', async () => {
    const { service, paymentModel } = build();

    const noIntent = await service.handleEvent({
      id: 'evt_3',
      type: 'charge.refunded',
      data: { object: { payment_intent: null, amount: 1, amount_refunded: 1 } },
    } as unknown as Stripe.Event);
    const other = await service.handleEvent({
      id: 'evt_4',
      type: 'customer.created',
      data: { object: {} },
    } as unknown as Stripe.Event);

    expect(noIntent.outcome).toBe('ignored');
    expect(other).toEqual({ received: true, outcome: 'ignored' });
    expect(paymentModel.updateOne).not.toHaveBeenCalled();
  });
});
