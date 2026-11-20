import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus, BookingType, PaymentStatus } from '../../common/enums';
import { PaymentsService } from './payments.service';

interface Chain<T> extends PromiseLike<T> {
  lean(): Chain<T>;
  select(): Chain<T>;
}
function query<T>(result: T): Chain<T> {
  const q: Chain<T> = {
    lean: () => q,
    select: () => q,
    then: (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return q;
}

const userId = new Types.ObjectId();

interface PaymentDoc {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  bookingType: BookingType;
  flightBooking: Types.ObjectId;
  amount: number;
  currency: string;
  status: PaymentStatus;
  stripePaymentIntentId?: string;
  metadata: { intentAttempts: number };
  createdAt: Date;
  updatedAt: Date;
}

function build() {
  const booking = {
    _id: new Types.ObjectId(),
    user: userId,
    bookingReference: 'ABCD2345',
    status: BookingStatus.PENDING_PAYMENT,
    holdExpiresAt: new Date(Date.now() + 5 * 60_000),
    policySnapshot: { legs: [] },
    policyAcceptedAt: new Date(),
    totalPrice: 200,
    currency: 'USD',
  };
  const store: { payment?: PaymentDoc } = {};
  const intents: string[] = [];
  const stripe = {
    paymentIntents: {
      create: jest.fn(() => {
        const id = `pi_${intents.length + 1}`;
        intents.push(id);
        return Promise.resolve({
          id,
          status: 'requires_payment_method',
          client_secret: `${id}_secret`,
        });
      }),
      retrieve: jest.fn((id: string) =>
        Promise.resolve({
          id,
          status: 'requires_payment_method',
          client_secret: `${id}_secret`,
        }),
      ),
      cancel: jest.fn().mockResolvedValue({ status: 'canceled' }),
    },
  };
  const flightBookingModel = {
    findOne: jest.fn(() => query(booking)),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
  };
  const paymentModel = {
    findOne: jest.fn(
      (filter: {
        status?: unknown;
        flightBooking?: unknown;
        _id?: Types.ObjectId;
      }) => {
        // createPayment looks for a live payment of the booking; retry looks up by id
        if (filter._id) return query(store.payment ?? null);
        return query(null);
      },
    ),
    create: jest.fn((doc: Record<string, unknown>) => {
      store.payment = {
        _id: new Types.ObjectId(),
        ...(doc as object),
        metadata: { intentAttempts: 1 },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as PaymentDoc;
      const live = store.payment;
      return Promise.resolve(
        Object.assign(live, { save: jest.fn().mockResolvedValue(undefined) }),
      );
    }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    // A tiny evaluator for the conditional updates the service makes.
    updateOne: jest.fn(
      (
        filter: {
          status?: { $in: PaymentStatus[] } | PaymentStatus;
          stripePaymentIntentId?: { $exists: boolean };
        },
        update: { $set: Record<string, unknown> },
      ) => {
        const doc = store.payment;
        if (!doc) return Promise.resolve({ modifiedCount: 0, matchedCount: 0 });
        const allowed =
          filter.status &&
          typeof filter.status === 'object' &&
          '$in' in filter.status
            ? filter.status.$in.includes(doc.status)
            : filter.status === undefined || filter.status === doc.status;
        const noIntent =
          filter.stripePaymentIntentId?.$exists === false
            ? doc.stripePaymentIntentId === undefined
            : true;
        if (!allowed || !noIntent)
          return Promise.resolve({ modifiedCount: 0, matchedCount: 0 });
        Object.assign(doc, update.$set);
        return Promise.resolve({ modifiedCount: 1, matchedCount: 1 });
      },
    ),
    findOneAndUpdate: jest.fn(
      (_f: unknown, update: { $set: Record<string, unknown> }) =>
        Promise.resolve({ ...store.payment, ...update.$set }),
    ),
  };
  const service = new PaymentsService(
    paymentModel as never,
    {} as never,
    flightBookingModel as never,
    { findOne: jest.fn(), updateOne: jest.fn() } as never,
    {
      get: jest.fn((key: string) =>
        key === 'stripe.secretKey' ? 'sk_test_dummy' : '',
      ),
    } as never,
  );
  (service as unknown as { stripe: unknown }).stripe = stripe;
  return {
    service,
    store,
    stripe,
    paymentModel,
    flightBookingModel,
    booking,
    intents,
  };
}

const dto = (booking: { _id: Types.ObjectId }) => ({
  bookingType: BookingType.FLIGHT,
  bookingId: booking._id.toString(),
});

describe('PaymentsService.createPayment: intent creation racing the payment expiry job', () => {
  it('hands out the client secret and attaches the intent when nothing else happened', async () => {
    const t = build();
    const res = await t.service.createPayment(
      userId.toString(),
      dto(t.booking),
    );
    expect(res.clientSecret).toBe('pi_1_secret');
    expect(t.store.payment?.stripePaymentIntentId).toBe('pi_1');
    expect(t.flightBookingModel.updateOne).toHaveBeenCalledTimes(1);
  });

  it('cancels the new intent and refuses when the expiry job marked the payment EXPIRED while Stripe was being called', async () => {
    const t = build();
    // The expiry job runs during the Stripe call: it sees a payment without an intent, so it only marks it EXPIRED.
    t.stripe.paymentIntents.create.mockImplementationOnce(() => {
      (t.store.payment as PaymentDoc).status = PaymentStatus.EXPIRED;
      t.intents.push('pi_1');
      return Promise.resolve({
        id: 'pi_1',
        status: 'requires_payment_method',
        client_secret: 'pi_1_secret',
      });
    });
    await expect(
      t.service.createPayment(userId.toString(), dto(t.booking)),
    ).rejects.toBeInstanceOf(ConflictException);
    // the intent that could still be paid is cancelled, never returned, never attached or linked
    expect(t.stripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_1');
    expect(t.store.payment?.stripePaymentIntentId).toBeUndefined();
    expect(t.store.payment?.status).toBe(PaymentStatus.EXPIRED);
    expect(t.flightBookingModel.updateOne).not.toHaveBeenCalled();
  });

  it('also refuses when the payment was cancelled in the meantime', async () => {
    const t = build();
    t.stripe.paymentIntents.create.mockImplementationOnce(() => {
      (t.store.payment as PaymentDoc).status = PaymentStatus.CANCELLED;
      return Promise.resolve({
        id: 'pi_1',
        status: 'requires_payment_method',
        client_secret: 'pi_1_secret',
      });
    });
    await expect(
      t.service.createPayment(userId.toString(), dto(t.booking)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(t.stripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_1');
  });
});
