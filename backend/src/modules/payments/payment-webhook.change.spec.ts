import { Types } from 'mongoose';
import Stripe from 'stripe';
import { BookingType, PaymentPurpose, PaymentStatus } from '../../common/enums';
import { PaymentPurposeRegistry } from './payment-purpose-handlers';
import { PaymentWebhookService } from './payment-webhook.service';

interface Chain<T> extends PromiseLike<T> {
  lean(): Chain<T>;
  select(): Chain<T>;
  session(): Chain<T>;
}
function query<T>(result: T): Chain<T> {
  const q: Chain<T> = {
    lean: () => q,
    select: () => q,
    session: () => q,
    then: (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return q;
}

const userId = new Types.ObjectId();
const bookingId = new Types.ObjectId();

function makeChangePayment(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    user: userId,
    bookingType: BookingType.FLIGHT,
    purpose: PaymentPurpose.FLIGHT_CHANGE,
    flightBooking: null,
    changedFlightBooking: bookingId,
    flightChange: new Types.ObjectId(),
    amount: 120,
    currency: 'USD',
    status: PaymentStatus.PENDING,
    stripePaymentIntentId: 'pi_change',
    ...overrides,
  };
}

function build(outcome: 'applied' | 'refund' | 'none') {
  const payment = makeChangePayment();
  const paymentModel = {
    findOne: jest.fn(() => query(payment)),
    findById: jest.fn(() =>
      query({ ...payment, metadata: { needsRefund: true } }),
    ),
    findOneAndUpdate: jest.fn(() => Promise.resolve({ ...payment })),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const flightBookingModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const refundsService = {
    recordRefund: jest.fn((input: Record<string, unknown>) =>
      Promise.resolve({ _id: new Types.ObjectId(), ...input }),
    ),
    dispatchRefund: jest.fn().mockResolvedValue(true),
  };
  const afterCommit = jest.fn().mockResolvedValue(undefined);
  const registry = new PaymentPurposeRegistry();
  if (outcome !== 'none') {
    registry.register(PaymentPurpose.FLIGHT_CHANGE, {
      settle: jest.fn().mockResolvedValue({ kind: outcome, afterCommit }),
    });
  }
  const session = { id: 'session' };
  const connection = {
    transaction: jest.fn((cb: (s: unknown) => Promise<unknown>) => cb(session)),
  };
  const notifications = { createNotification: jest.fn().mockResolvedValue({}) };
  const service = new PaymentWebhookService(
    {
      stripe: new Stripe('sk_test_dummy') as unknown,
      paymentModel,
      flightBookingModel,
      hotelBookingModel: { findOne: jest.fn() },
    } as never,
    { get: jest.fn() } as never,
    notifications as never,
    refundsService as never,
    { updateOne: jest.fn() } as never,
    { updateOne: jest.fn() } as never,
    connection as never,
    registry,
  );
  return {
    service,
    payment,
    paymentModel,
    refundsService,
    afterCommit,
    flightBookingModel,
    notifications,
  };
}

const event = (): Stripe.Event =>
  ({
    id: 'evt_1',
    type: 'payment_intent.succeeded',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: { id: 'pi_change', amount_received: 12000, currency: 'usd' },
    },
  }) as unknown as Stripe.Event;

describe('PaymentWebhookService: payments of a flight change', () => {
  it('lets the change handler apply it and never touches the booking itself', async () => {
    const t = build('applied');
    await expect(t.service.handleEvent(event())).resolves.toEqual({
      received: true,
      outcome: 'confirmed',
    });
    expect(t.afterCommit).toHaveBeenCalledTimes(1);
    expect(t.flightBookingModel.findOne).not.toHaveBeenCalled();
    expect(t.refundsService.recordRefund).not.toHaveBeenCalled();
  });

  it('refunds the whole payment when the handler cannot apply the change', async () => {
    const t = build('refund');
    await expect(t.service.handleEvent(event())).resolves.toEqual({
      received: true,
      outcome: 'orphaned',
    });
    expect(t.afterCommit).toHaveBeenCalledTimes(1);
    expect(t.paymentModel.updateOne).toHaveBeenCalledWith(
      { _id: t.payment._id },
      { $set: { 'metadata.needsRefund': true } },
      expect.anything(),
    );
    expect(t.refundsService.recordRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        payment: t.payment._id,
        bookingId,
        amount: 120,
        reason: 'The flight change could not be applied',
      }),
    );
    expect(t.refundsService.dispatchRefund).toHaveBeenCalledTimes(1);
  });

  it('refunds when nothing is registered for flight changes', async () => {
    const t = build('none');
    await expect(t.service.handleEvent(event())).resolves.toEqual({
      received: true,
      outcome: 'orphaned',
    });
    expect(t.refundsService.recordRefund).toHaveBeenCalledTimes(1);
  });
});
