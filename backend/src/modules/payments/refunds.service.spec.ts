import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  BookingType,
  NotificationType,
  PaymentStatus,
  RefundStatus,
  Role,
} from '../../common/enums';
import { MAX_REFUND_ATTEMPTS, RefundsService } from './refunds.service';

interface Chain<T> extends PromiseLike<T> {
  lean(): Chain<T>;
  select(): Chain<T>;
  sort(): Chain<T>;
  limit(): Chain<T>;
  session(): Chain<T>;
}

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
const otherUserId = new Types.ObjectId();

function makeRefund(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    payment: new Types.ObjectId(),
    user: userId,
    bookingType: BookingType.FLIGHT,
    bookingId: new Types.ObjectId(),
    amount: 170.25,
    currency: 'USD',
    status: RefundStatus.PENDING,
    reason: 'Cancelled by the traveller',
    policyCalculationNotes: '10 day(s) before departure: ... 50%',
    attempts: 0,
    createdAt: new Date('2026-11-19T10:00:00Z'),
    updatedAt: new Date('2026-11-19T10:00:00Z'),
    ...overrides,
  };
}

function build() {
  const refundModel = {
    findOne: jest.fn(() => query<unknown>(null)),
    find: jest.fn(() => query<unknown[]>([])),
    create: jest.fn((docs: Record<string, unknown>[]) =>
      Promise.resolve(
        docs.map((doc) => ({ _id: new Types.ObjectId(), ...doc })),
      ),
    ),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const paymentModel = { findById: jest.fn() };
  const stripe = { refunds: { create: jest.fn() } };
  const paymentsService = { stripe: stripe as unknown };
  const notificationsService = {
    createNotification: jest.fn().mockResolvedValue({}),
  };
  const service = new RefundsService(
    refundModel as never,
    paymentModel as never,
    paymentsService as never,
    notificationsService as never,
  );
  return {
    service,
    refundModel,
    paymentModel,
    stripe,
    paymentsService,
    notificationsService,
  };
}

describe('RefundsService.recordRefund', () => {
  const input = {
    payment: new Types.ObjectId(),
    user: userId,
    bookingType: BookingType.FLIGHT,
    bookingId: new Types.ObjectId(),
    amount: 100,
    currency: 'USD',
    reason: 'Cancelled by the traveller',
    notes: 'notes',
  };

  it('records a PENDING refund inside the given transaction session', async () => {
    const { service, refundModel } = build();
    const session = { id: 's' };

    const refund = await service.recordRefund(input, session as never);

    const [docs, options] = refundModel.create.mock.calls[0] as unknown as [
      Record<string, unknown>[],
      { session: unknown },
    ];
    expect(docs[0]).toMatchObject({
      payment: input.payment,
      status: RefundStatus.PENDING,
      amount: 100,
      reason: 'Cancelled by the traveller',
      policyCalculationNotes: 'notes',
    });
    expect(options.session).toBe(session);
    expect(refund.status).toBe(RefundStatus.PENDING);
  });

  it('returns the existing refund instead of recording a payment twice', async () => {
    const { service, refundModel } = build();
    const existing = makeRefund({ payment: input.payment });
    refundModel.findOne.mockReturnValue(query(existing));

    expect(await service.recordRefund(input)).toBe(existing);
    expect(refundModel.create).not.toHaveBeenCalled();
  });
});

describe('RefundsService.dispatchRefund', () => {
  function setup(
    refundOverrides: Record<string, unknown> = {},
    paymentOverrides: Record<string, unknown> = {},
  ) {
    const ctx = build();
    const refund = makeRefund(refundOverrides);
    const payment = {
      _id: refund.payment,
      stripePaymentIntentId: 'pi_123',
      status: PaymentStatus.SUCCEEDED,
      ...paymentOverrides,
    };
    ctx.refundModel.findOne.mockReturnValue(query(refund));
    ctx.paymentModel.findById.mockReturnValue(query(payment));
    ctx.refundModel.findOneAndUpdate.mockImplementation(
      (_f: unknown, update: { $set: Record<string, unknown> }) =>
        Promise.resolve({ ...refund, ...update.$set }),
    );
    return { ...ctx, refund, payment };
  }

  it('sends the refund through the Stripe Refunds API in minor units with an idempotency key', async () => {
    const { service, stripe, refund } = setup();
    stripe.refunds.create.mockResolvedValue({
      id: 're_1',
      status: 'succeeded',
    });

    expect(await service.dispatchRefund(refund._id)).toBe(true);

    expect(stripe.refunds.create).toHaveBeenCalledWith(
      {
        payment_intent: 'pi_123',
        amount: 17025,
        metadata: expect.objectContaining({
          refundId: refund._id.toString(),
        }) as unknown,
      },
      { idempotencyKey: `refund-${refund._id.toString()}` },
    );
  });

  it('records the Stripe id, marks SUCCEEDED and notifies once', async () => {
    const { service, stripe, refund, refundModel, notificationsService } =
      setup();
    stripe.refunds.create.mockResolvedValue({
      id: 're_1',
      status: 'succeeded',
    });

    await service.dispatchRefund(refund._id);

    const [filter, update] = refundModel.findOneAndUpdate.mock.calls[0] as [
      { stripeRefundId: null },
      { $set: Record<string, unknown> },
    ];
    expect(filter.stripeRefundId).toBeNull(); // only the first writer wins
    expect(update.$set).toMatchObject({
      stripeRefundId: 're_1',
      status: RefundStatus.SUCCEEDED,
    });
    expect(update.$set.processedAt).toBeInstanceOf(Date);
    expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.REFUND_PROCESSED,
        recipient: userId,
        message: 'Your refund of 170.25 USD was issued.',
      }),
    );
  });

  it('keeps a pending Stripe refund PENDING (it settles later) and says it is being processed', async () => {
    const { service, stripe, refund, refundModel, notificationsService } =
      setup();
    stripe.refunds.create.mockResolvedValue({ id: 're_2', status: 'pending' });

    await service.dispatchRefund(refund._id);

    const [, update] = refundModel.findOneAndUpdate.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set.status).toBe(RefundStatus.PENDING);
    expect(update.$set.processedAt).toBeUndefined();
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Your refund of 170.25 USD is being processed.',
      }),
    );
  });

  it('records a refund Stripe refused as FAILED with the reason', async () => {
    const { service, stripe, refund, refundModel } = setup();
    stripe.refunds.create.mockResolvedValue({
      id: 're_3',
      status: 'failed',
      failure_reason: 'expired_or_canceled_card',
    });

    await service.dispatchRefund(refund._id);

    const [, update] = refundModel.findOneAndUpdate.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set).toMatchObject({
      status: RefundStatus.FAILED,
      failureReason: 'expired_or_canceled_card',
    });
  });

  it('does not notify again when another call already recorded the Stripe refund', async () => {
    const { service, stripe, refund, refundModel, notificationsService } =
      setup();
    stripe.refunds.create.mockResolvedValue({
      id: 're_1',
      status: 'succeeded',
    });
    refundModel.findOneAndUpdate.mockResolvedValue(null);

    await service.dispatchRefund(refund._id);

    expect(notificationsService.createNotification).not.toHaveBeenCalled();
  });

  it('is a no-op for a refund that was already sent or settled', async () => {
    const { service, stripe, refundModel } = setup();
    refundModel.findOne.mockReturnValue(query(null));

    expect(await service.dispatchRefund(new Types.ObjectId())).toBe(true);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('counts a failed Stripe call and leaves the refund PENDING for the job to retry', async () => {
    const { service, stripe, refund, refundModel } = setup();
    stripe.refunds.create.mockRejectedValue(new Error('network down'));
    refundModel.findOneAndUpdate.mockResolvedValue({ ...refund, attempts: 1 });

    expect(await service.dispatchRefund(refund._id)).toBe(false);

    const [, update] = refundModel.findOneAndUpdate.mock.calls[0] as [
      unknown,
      { $inc: { attempts: number }; $set: { failureReason: string } },
    ];
    expect(update.$inc).toEqual({ attempts: 1 });
    expect(update.$set.failureReason).toBe('network down');
  });

  it('gives up with FAILED after the maximum number of attempts and tells the user', async () => {
    const { service, stripe, refund, refundModel, notificationsService } =
      setup();
    stripe.refunds.create.mockRejectedValue(new Error('network down'));
    refundModel.findOneAndUpdate
      .mockResolvedValueOnce({ ...refund, attempts: MAX_REFUND_ATTEMPTS })
      .mockImplementationOnce(
        (_f: unknown, update: { $set: Record<string, unknown> }) =>
          Promise.resolve({ ...refund, ...update.$set }),
      );

    await service.dispatchRefund(refund._id);

    const [, failUpdate] = refundModel.findOneAndUpdate.mock.calls[1] as [
      unknown,
      { $set: { status: RefundStatus; failureReason: string } },
    ];
    expect(failUpdate.$set.status).toBe(RefundStatus.FAILED);
    expect(failUpdate.$set.failureReason).toContain('Gave up after');
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Refund failed' }),
    );
  });

  it('fails a refund whose payment has no Stripe charge', async () => {
    const { service, stripe, refund, refundModel } = setup(
      {},
      { stripePaymentIntentId: undefined },
    );

    await service.dispatchRefund(refund._id);

    expect(stripe.refunds.create).not.toHaveBeenCalled();
    const [, update] = refundModel.findOneAndUpdate.mock.calls[0] as [
      unknown,
      { $set: { status: RefundStatus } },
    ];
    expect(update.$set.status).toBe(RefundStatus.FAILED);
  });

  it('does nothing without Stripe configured', async () => {
    const { service, paymentsService, refund } = setup();
    Object.assign(paymentsService, { stripe: null });

    expect(await service.dispatchRefund(refund._id)).toBe(false);
  });
});

describe('RefundsService.dispatchUnsentRefunds', () => {
  it('re-sends refunds that never reached Stripe, oldest first', async () => {
    const { service, refundModel, stripe, paymentModel } = build();
    const refund = makeRefund();
    refundModel.find.mockReturnValue(query([{ _id: refund._id }]));
    refundModel.findOne.mockReturnValue(query(refund));
    paymentModel.findById.mockReturnValue(
      query({
        _id: refund.payment,
        stripePaymentIntentId: 'pi_1',
        status: PaymentStatus.SUCCEEDED,
      }),
    );
    stripe.refunds.create.mockResolvedValue({
      id: 're_9',
      status: 'succeeded',
    });
    refundModel.findOneAndUpdate.mockResolvedValue({
      ...refund,
      status: RefundStatus.SUCCEEDED,
    });

    expect(await service.dispatchUnsentRefunds()).toBe(1);

    const [filter] = refundModel.find.mock.calls[0] as unknown as [
      { status: RefundStatus; stripeRefundId: null; createdAt: { $lte: Date } },
    ];
    expect(filter.status).toBe(RefundStatus.PENDING);
    expect(filter.stripeRefundId).toBeNull();
    expect(filter.createdAt.$lte.getTime()).toBeLessThan(Date.now());
  });

  it('keeps going when one refund throws', async () => {
    const { service, refundModel } = build();
    const a = new Types.ObjectId();
    const b = new Types.ObjectId();
    refundModel.find.mockReturnValue(query([{ _id: a }, { _id: b }]));
    refundModel.findOne
      .mockImplementationOnce(() => {
        throw new Error('db hiccup');
      })
      .mockReturnValueOnce(query(null));

    expect(await service.dispatchUnsentRefunds()).toBe(1);
  });

  it('does nothing without Stripe configured', async () => {
    const { service, paymentsService, refundModel } = build();
    Object.assign(paymentsService, { stripe: null });

    expect(await service.dispatchUnsentRefunds()).toBe(0);
    expect(refundModel.find).not.toHaveBeenCalled();
  });
});

describe('RefundsService.getRefund', () => {
  const processedAt = new Date('2026-11-19T10:05:00Z');
  const refund = makeRefund({ status: RefundStatus.SUCCEEDED, processedAt });

  it('returns the owner their refund without Stripe ids', async () => {
    const { service, refundModel } = build();
    refundModel.findOne.mockReturnValue(
      query({ ...refund, stripeRefundId: 're_secret' }),
    );

    const result = await service.getRefund(
      userId.toString(),
      Role.REGISTERED_USER,
      refund._id.toString(),
    );

    expect(result).toEqual({
      id: refund._id.toString(),
      paymentId: refund.payment.toString(),
      bookingType: BookingType.FLIGHT,
      bookingId: refund.bookingId.toString(),
      amount: 170.25,
      currency: 'USD',
      status: RefundStatus.SUCCEEDED,
      reason: 'Cancelled by the traveller',
      policyCalculationNotes: '10 day(s) before departure: ... 50%',
      failureReason: null,
      processedAt,
      createdAt: refund.createdAt,
      updatedAt: refund.updatedAt,
    });
    expect(JSON.stringify(result)).not.toContain('re_secret');
    const [filter] = refundModel.findOne.mock.calls[0] as unknown as [
      { user?: Types.ObjectId },
    ];
    expect(filter.user?.equals(userId)).toBe(true);
  });

  it('lets an admin read any refund (no owner filter)', async () => {
    const { service, refundModel } = build();
    refundModel.findOne.mockReturnValue(query(refund));

    await service.getRefund(
      otherUserId.toString(),
      Role.ADMIN,
      refund._id.toString(),
    );

    const [filter] = refundModel.findOne.mock.calls[0] as unknown as [
      { user?: Types.ObjectId },
    ];
    expect(filter.user).toBeUndefined();
  });

  it("is a 404 for another user's refund, an unknown id and a malformed id", async () => {
    const { service, refundModel } = build();

    await expect(
      service.getRefund(
        otherUserId.toString(),
        Role.REGISTERED_USER,
        refund._id.toString(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.getRefund(userId.toString(), Role.REGISTERED_USER, 'nope'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(refundModel.findOne).toHaveBeenCalledTimes(1);
  });
});

describe('RefundsService Stripe events', () => {
  it('settleForPayment turns a sent PENDING refund into SUCCEEDED', async () => {
    const { service, refundModel } = build();
    const paymentId = new Types.ObjectId();

    expect(await service.settleForPayment(paymentId)).toBe(true);

    const [filter, update] = refundModel.updateOne.mock.calls[0] as unknown as [
      {
        payment: Types.ObjectId;
        status: RefundStatus;
        stripeRefundId: { $ne: null };
      },
      { $set: { status: RefundStatus; processedAt: Date } },
    ];
    expect(filter.payment).toBe(paymentId);
    expect(filter.status).toBe(RefundStatus.PENDING);
    expect(filter.stripeRefundId).toEqual({ $ne: null });
    expect(update.$set.status).toBe(RefundStatus.SUCCEEDED);
  });

  it('settleForPayment is idempotent (already settled changes nothing)', async () => {
    const { service, refundModel } = build();
    refundModel.updateOne.mockResolvedValue({ modifiedCount: 0 });

    expect(await service.settleForPayment(new Types.ObjectId())).toBe(false);
  });

  it('syncFromStripe marks a failed refund FAILED and notifies the user', async () => {
    const { service, refundModel, notificationsService } = build();
    const refund = makeRefund({ status: RefundStatus.FAILED });
    refundModel.findOneAndUpdate.mockResolvedValue(refund);

    const changed = await service.syncFromStripe({
      id: 're_1',
      status: 'failed',
      failure_reason: 'lost_or_stolen_card',
    } as never);

    expect(changed).toBe(true);
    const [filter, update] = refundModel.findOneAndUpdate.mock
      .calls[0] as unknown as [
      { stripeRefundId: string; status: RefundStatus },
      { $set: { status: RefundStatus; failureReason: string } },
    ];
    expect(filter).toMatchObject({
      stripeRefundId: 're_1',
      status: RefundStatus.PENDING,
    });
    expect(update.$set).toMatchObject({
      status: RefundStatus.FAILED,
      failureReason: 'lost_or_stolen_card',
    });
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Refund failed' }),
    );
  });

  it('syncFromStripe marks a succeeded refund SUCCEEDED without a second notification', async () => {
    const { service, refundModel, notificationsService } = build();
    refundModel.findOneAndUpdate.mockResolvedValue(
      makeRefund({ status: RefundStatus.SUCCEEDED }),
    );

    expect(
      await service.syncFromStripe({
        id: 're_1',
        status: 'succeeded',
      } as never),
    ).toBe(true);
    expect(notificationsService.createNotification).not.toHaveBeenCalled();
  });

  it('syncFromStripe ignores a still-pending refund and an unknown or already settled one', async () => {
    const { service, refundModel } = build();

    expect(
      await service.syncFromStripe({ id: 're_1', status: 'pending' } as never),
    ).toBe(false);
    expect(refundModel.findOneAndUpdate).not.toHaveBeenCalled();
    refundModel.findOneAndUpdate.mockResolvedValue(null);
    expect(
      await service.syncFromStripe({
        id: 're_x',
        status: 'succeeded',
      } as never),
    ).toBe(false);
  });
});
