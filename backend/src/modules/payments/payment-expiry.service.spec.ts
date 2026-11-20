import { Types } from 'mongoose';
import { BookingType, PaymentStatus } from '../../common/enums';
import { PaymentExpiryService } from './payment-expiry.service';

interface Chain<T> extends PromiseLike<T> {
  sort(): Chain<T>;
  limit(): Chain<T>;
  lean(): Chain<T>;
}

function query<T>(result: T): Chain<T> {
  const q: Chain<T> = {
    sort: () => q,
    limit: () => q,
    lean: () => q,
    then: (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return q;
}

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    user: new Types.ObjectId(),
    bookingType: BookingType.FLIGHT,
    flightBooking: new Types.ObjectId(),
    amount: 100,
    currency: 'USD',
    status: PaymentStatus.PENDING,
    stripePaymentIntentId: 'pi_1',
    holdExpiresAt: new Date(Date.now() - 1000),
    ...overrides,
  };
}

function build(payments: ReturnType<typeof makePayment>[] = []) {
  const stripe = {
    paymentIntents: { retrieve: jest.fn() },
    charges: { retrieve: jest.fn() },
  };
  const paymentModel = {
    find: jest.fn(() => query(payments)),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const paymentsService = {
    stripe,
    paymentModel,
    cancelIntent: jest.fn().mockResolvedValue(true),
  };
  const webhook = {
    processSucceededIntent: jest.fn().mockResolvedValue('confirmed'),
  };
  const service = new PaymentExpiryService(
    paymentsService as never,
    webhook as never,
  );
  return { service, stripe, paymentModel, paymentsService, webhook };
}

describe('PaymentExpiryService.expireLapsedPayments', () => {
  it('only looks at open payments whose own hold has passed, oldest check first', async () => {
    const { service, paymentModel } = build();

    await service.expireLapsedPayments();

    const [filter] = paymentModel.find.mock.calls[0] as unknown as [
      { status: { $in: PaymentStatus[] }; holdExpiresAt: { $lte: Date } },
    ];
    expect(filter.status.$in).toEqual([
      PaymentStatus.PENDING,
      PaymentStatus.PROCESSING,
      PaymentStatus.FAILED,
    ]);
    expect(filter.holdExpiresAt.$lte).toBeInstanceOf(Date);
  });

  it('cancels the intent at Stripe and marks the payment EXPIRED', async () => {
    const payment = makePayment({ status: PaymentStatus.FAILED });
    const { service, paymentsService, paymentModel } = build([payment]);

    expect(await service.expireLapsedPayments()).toBe(1);

    expect(paymentsService.cancelIntent).toHaveBeenCalledWith(
      expect.anything(),
      'pi_1',
    );
    expect(paymentModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: payment._id }),
      { $set: { status: PaymentStatus.EXPIRED } },
    );
  });

  it('reconciles an intent Stripe already completed (webhook never arrived) instead of expiring it', async () => {
    const payment = makePayment();
    const { service, stripe, paymentsService, webhook, paymentModel } = build([
      payment,
    ]);
    paymentsService.cancelIntent.mockResolvedValue(false);
    const intent = {
      id: 'pi_1',
      status: 'succeeded',
      latest_charge: 'ch_1',
      created: 1000,
    };
    stripe.paymentIntents.retrieve.mockResolvedValue(intent);
    stripe.charges.retrieve.mockResolvedValue({ created: 1_700_000_000 });

    expect(await service.expireLapsedPayments()).toBe(1);

    expect(webhook.processSucceededIntent).toHaveBeenCalledWith(
      intent,
      new Date(1_700_000_000 * 1000),
    );
    expect(paymentModel.updateOne).not.toHaveBeenCalled();
  });

  it('falls back to the intent creation time when the charge cannot be read', async () => {
    const payment = makePayment();
    const { service, stripe, paymentsService, webhook } = build([payment]);
    paymentsService.cancelIntent.mockResolvedValue(false);
    stripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_1',
      status: 'succeeded',
      latest_charge: 'ch_1',
      created: 2000,
    });
    stripe.charges.retrieve.mockRejectedValue(new Error('boom'));

    await service.expireLapsedPayments();

    expect(webhook.processSucceededIntent).toHaveBeenCalledWith(
      expect.anything(),
      new Date(2000 * 1000),
    );
  });

  it('rotates a payment Stripe cannot cancel yet (processing) instead of blocking the batch', async () => {
    const payment = makePayment({ status: PaymentStatus.PROCESSING });
    const { service, stripe, paymentsService, paymentModel, webhook } = build([
      payment,
    ]);
    paymentsService.cancelIntent.mockResolvedValue(false);
    stripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_1',
      status: 'processing',
    });

    expect(await service.expireLapsedPayments()).toBe(0);

    expect(webhook.processSucceededIntent).not.toHaveBeenCalled();
    expect(paymentModel.updateOne).toHaveBeenCalledWith(
      { _id: payment._id },
      { $set: { 'metadata.expiryCheckedAt': expect.any(Date) as unknown } },
    );
  });

  it('keeps going when one payment fails', async () => {
    const bad = makePayment({ stripePaymentIntentId: 'pi_bad' });
    const good = makePayment({ stripePaymentIntentId: 'pi_good' });
    const { service, paymentsService } = build([bad, good]);
    paymentsService.cancelIntent.mockImplementation(
      (_s: unknown, id: string) =>
        id === 'pi_bad'
          ? Promise.reject(new Error('stripe down'))
          : Promise.resolve(true),
    );

    expect(await service.expireLapsedPayments()).toBe(1);
  });

  it('does nothing without Stripe configured', async () => {
    const { service, paymentsService, paymentModel } = build();
    Object.assign(paymentsService, { stripe: null });

    expect(await service.expireLapsedPayments()).toBe(0);
    expect(paymentModel.find).not.toHaveBeenCalled();
  });
});
