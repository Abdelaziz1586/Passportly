import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
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
  const stripe = { refunds: { create: jest.fn(), retrieve: jest.fn() } };
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
    currency: 'usd',
    reason: 'Cancelled by the traveller',
    notes: 'notes',
  };

  function setupRecord(paymentOverrides: Record<string, unknown> | null = {}) {
    const ctx = build();
    ctx.paymentModel.findById.mockReturnValue(
      query(
        paymentOverrides === null
          ? null
          : {
              _id: input.payment,
              status: PaymentStatus.SUCCEEDED,
              amount: 150,
              currency: 'USD',
              ...paymentOverrides,
            },
      ),
    );
    return ctx;
  }

  it('records a PENDING refund inside the given transaction session', async () => {
    const { service, refundModel } = setupRecord();
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
      currency: 'USD',
      reason: 'Cancelled by the traveller',
      policyCalculationNotes: 'notes',
    });
    expect(options.session).toBe(session);
    expect(refund.status).toBe(RefundStatus.PENDING);
  });

  it('returns the existing refund instead of recording a payment twice', async () => {
    const { service, refundModel } = setupRecord();
    const existing = makeRefund({ payment: input.payment });
    refundModel.findOne.mockReturnValue(query(existing));

    expect(await service.recordRefund(input)).toBe(existing);
    expect(refundModel.create).not.toHaveBeenCalled();
  });

  it('returns the winner when two requests race and the unique index rejects the second', async () => {
    const { service, refundModel } = setupRecord();
    const winner = makeRefund({ payment: input.payment });
    refundModel.findOne
      .mockReturnValueOnce(query(null))
      .mockReturnValueOnce(query(winner));
    refundModel.create.mockRejectedValue({ code: 11000 });

    expect(await service.recordRefund(input)).toBe(winner);
  });

  it('does not swallow a duplicate-key error inside a transaction (the caller must abort)', async () => {
    const { service, refundModel } = setupRecord();
    refundModel.create.mockRejectedValue({ code: 11000 });

    await expect(
      service.recordRefund(input, { id: 's' } as never),
    ).rejects.toEqual({
      code: 11000,
    });
  });

  it.each([0, -5, Number.NaN])('rejects a refund of %p', async (amount) => {
    const { service, refundModel } = setupRecord();

    await expect(
      service.recordRefund({ ...input, amount }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(refundModel.create).not.toHaveBeenCalled();
  });

  it('rejects a refund above the payment or in another currency', async () => {
    const { service } = setupRecord();

    await expect(
      service.recordRefund({ ...input, amount: 150.01 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.recordRefund({ ...input, currency: 'EUR' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    PaymentStatus.PENDING,
    PaymentStatus.FAILED,
    PaymentStatus.EXPIRED,
    PaymentStatus.CANCELLED,
    PaymentStatus.REFUNDED,
  ])('rejects a refund of a %s payment', async (status) => {
    const { service } = setupRecord({ status });

    await expect(service.recordRefund(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('accepts a PARTIALLY_REFUNDED payment and rejects an unknown one', async () => {
    const partial = setupRecord({ status: PaymentStatus.PARTIALLY_REFUNDED });
    await expect(partial.service.recordRefund(input)).resolves.toBeDefined();

    const unknown = setupRecord(null);
    await expect(unknown.service.recordRefund(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
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
    expect((update as unknown as { $unset: unknown }).$unset).toEqual({
      failureReason: 1,
    });
    expect(update.$set.processedAt).toBeInstanceOf(Date);
    expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.REFUND_PROCESSED,
        recipient: userId,
        message: expect.stringContaining(
          'Your refund of 170.25 USD was issued.',
        ) as unknown,
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
        message: expect.stringContaining(
          'Your refund of 170.25 USD is being processed.',
        ) as unknown,
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
    // the raw Stripe message is only logged: it can contain object ids
    expect(update.$set.failureReason).toBe(
      'The payment provider could not complete the refund',
    );
  });

  it.each(['StripeConnectionError', 'StripeAPIError', 'StripeRateLimitError'])(
    'an outage (%s) never counts towards giving up',
    async (type) => {
      const { service, stripe, refund, refundModel } = setup();
      stripe.refunds.create.mockRejectedValue({ type, message: 'outage' });

      expect(await service.dispatchRefund(refund._id)).toBe(false);

      expect(refundModel.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );

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
    expect(failUpdate.$set.failureReason).toBe(
      'The payment provider could not complete the refund',
    );
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Refund failed' }),
    );
  });

  it.each([
    PaymentStatus.PENDING,
    PaymentStatus.PROCESSING,
    PaymentStatus.FAILED,
    PaymentStatus.EXPIRED,
    PaymentStatus.CANCELLED,
    PaymentStatus.REFUNDED,
  ])(
    'fails at once, without calling Stripe, when the payment is %s',
    async (status) => {
      const { service, stripe, refund, refundModel } = setup({}, { status });

      await service.dispatchRefund(refund._id);

      expect(stripe.refunds.create).not.toHaveBeenCalled();
      const [, update] = refundModel.findOneAndUpdate.mock.calls[0] as [
        unknown,
        { $set: { status: RefundStatus } },
      ];
      expect(update.$set.status).toBe(RefundStatus.FAILED);
    },
  );

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
  it("settleForPayment follows Stripe's state of the sent PENDING refund", async () => {
    const { service, refundModel, stripe, notificationsService } = build();
    const paymentId = new Types.ObjectId();
    refundModel.findOne.mockReturnValue(
      query(makeRefund({ payment: paymentId, stripeRefundId: 're_1' })),
    );
    stripe.refunds.retrieve.mockResolvedValue({
      id: 're_1',
      status: 'succeeded',
      metadata: {},
    });
    refundModel.findOneAndUpdate.mockResolvedValue(
      makeRefund({ status: RefundStatus.SUCCEEDED }),
    );

    expect(await service.settleForPayment(paymentId)).toBe(true);

    const [filter] = refundModel.findOne.mock.calls[0] as unknown as [
      {
        payment: Types.ObjectId;
        status: RefundStatus;
        stripeRefundId: { $ne: null };
      },
    ];
    expect(filter.payment).toBe(paymentId);
    expect(filter.status).toBe(RefundStatus.PENDING);
    expect(filter.stripeRefundId).toEqual({ $ne: null });
    expect(stripe.refunds.retrieve).toHaveBeenCalledWith('re_1');
    // the user hears that the refund went through
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('was issued') as unknown,
      }),
    );
  });

  it('settleForPayment does not close a refund Stripe still reports as pending', async () => {
    const { service, refundModel, stripe } = build();
    refundModel.findOne.mockReturnValue(
      query(makeRefund({ stripeRefundId: 're_1' })),
    );
    stripe.refunds.retrieve.mockResolvedValue({
      id: 're_1',
      status: 'pending',
      metadata: {},
    });

    expect(await service.settleForPayment(new Types.ObjectId())).toBe(false);
    expect(refundModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('settleForPayment is idempotent and survives a Stripe read error', async () => {
    const { service, refundModel, stripe } = build();

    expect(await service.settleForPayment(new Types.ObjectId())).toBe(false); // nothing pending

    refundModel.findOne.mockReturnValue(
      query(makeRefund({ stripeRefundId: 're_1' })),
    );
    stripe.refunds.retrieve = jest
      .fn()
      .mockRejectedValue(new Error('stripe down'));
    expect(await service.settleForPayment(new Types.ObjectId())).toBe(false);
  });

  it('syncFromStripe marks a failed refund FAILED with the Stripe code and notifies the user', async () => {
    const { service, refundModel, notificationsService } = build();
    refundModel.findOneAndUpdate.mockResolvedValue(
      makeRefund({ status: RefundStatus.FAILED }),
    );

    const changed = await service.syncFromStripe({
      id: 're_1',
      status: 'failed',
      failure_reason: 'lost_or_stolen_card',
      metadata: {},
    } as never);

    expect(changed).toBe(true);
    const [filter, update] = refundModel.findOneAndUpdate.mock
      .calls[0] as unknown as [
      { $or: unknown[] },
      { $set: { status: RefundStatus; failureReason: string } },
    ];
    expect(filter.$or).toEqual([{ stripeRefundId: 're_1' }]);
    expect(update.$set).toMatchObject({
      status: RefundStatus.FAILED,
      failureReason: 'lost_or_stolen_card',
    });
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Refund failed' }),
    );
  });

  it('syncFromStripe also finds a refund by our id in the Stripe metadata and revives a given-up one', async () => {
    const { service, refundModel } = build();
    const refundId = new Types.ObjectId();
    refundModel.findOneAndUpdate.mockResolvedValue(
      makeRefund({ status: RefundStatus.SUCCEEDED }),
    );

    await service.syncFromStripe({
      id: 're_late',
      status: 'succeeded',
      metadata: { refundId: refundId.toString() },
    } as never);

    const [filter, update] = refundModel.findOneAndUpdate.mock
      .calls[0] as unknown as [
      {
        $or: Record<string, unknown>[];
        $and: { $or: Record<string, unknown>[] }[];
      },
      { $set: Record<string, unknown>; $unset: Record<string, unknown> },
    ];
    expect(filter.$or).toHaveLength(2);
    expect(filter.$or[1]._id).toEqual(refundId);
    // PENDING settles; FAILED settles only when its Stripe id was never recorded
    expect(filter.$and[0].$or).toEqual([
      { status: RefundStatus.PENDING },
      { status: RefundStatus.FAILED, stripeRefundId: null },
    ]);
    expect(update.$set).toMatchObject({
      stripeRefundId: 're_late',
      status: RefundStatus.SUCCEEDED,
    });
    expect(update.$unset).toEqual({ failureReason: 1 });
  });

  it('syncFromStripe ignores a malformed metadata id', async () => {
    const { service, refundModel } = build();
    refundModel.findOneAndUpdate.mockResolvedValue(null);

    await service.syncFromStripe({
      id: 're_1',
      status: 'succeeded',
      metadata: { refundId: 'not-an-id' },
    } as never);

    const [filter] = refundModel.findOneAndUpdate.mock.calls[0] as unknown as [
      { $or: unknown[] },
    ];
    expect(filter.$or).toHaveLength(1);
  });

  it('syncFromStripe tells the user when a PENDING refund becomes SUCCEEDED, once', async () => {
    const { service, refundModel, notificationsService } = build();
    refundModel.findOneAndUpdate.mockResolvedValueOnce(
      makeRefund({ status: RefundStatus.SUCCEEDED }),
    );

    expect(
      await service.syncFromStripe({
        id: 're_1',
        status: 'succeeded',
        metadata: {},
      } as never),
    ).toBe(true);
    expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);

    refundModel.findOneAndUpdate.mockResolvedValueOnce(null); // replay: already settled
    expect(
      await service.syncFromStripe({
        id: 're_1',
        status: 'succeeded',
        metadata: {},
      } as never),
    ).toBe(false);
    expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
  });

  it('syncFromStripe ignores a still-pending refund', async () => {
    const { service, refundModel } = build();

    expect(
      await service.syncFromStripe({
        id: 're_1',
        status: 'pending',
        metadata: {},
      } as never),
    ).toBe(false);
    expect(refundModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('notification text', () => {
  it('names the reason of the refund', async () => {
    const { service, refundModel, notificationsService } = build();
    refundModel.findOneAndUpdate.mockResolvedValue(
      makeRefund({
        status: RefundStatus.SUCCEEDED,
        reason: 'Payment received after the booking hold ended',
      }),
    );

    await service.syncFromStripe({
      id: 're_1',
      status: 'succeeded',
      metadata: {},
    } as never);

    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          'Reason: Payment received after the booking hold ended',
        ) as unknown,
      }),
    );
  });
});
