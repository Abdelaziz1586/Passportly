import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  BookingStatus,
  BookingType,
  NotificationType,
  PaymentStatus,
  RefundStatus,
} from '../../common/enums';
import { HotelCancellationService } from './hotel-cancellation.service';

interface Chain<T> extends PromiseLike<T> {
  lean(): Chain<T>;
  session(s?: unknown): Chain<T>;
}

function query<T>(result: T, onSession?: (s: unknown) => void): Chain<T> {
  const q: Chain<T> = {
    lean: () => q,
    session: (s?: unknown) => {
      onSession?.(s);
      return q;
    },
    then: (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return q;
}

const userId = new Types.ObjectId();
const paymentId = new Types.ObjectId();
const DAY = 86_400_000;
const utcMidnight = (offsetDays: number) => {
  const n = new Date();
  return new Date(
    Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) +
      offsetDays * DAY,
  );
};

const TIERS = [
  { daysBeforeCheckIn: 14, refundPercentage: 100 },
  { daysBeforeCheckIn: 7, refundPercentage: 80 },
  { daysBeforeCheckIn: 2, refundPercentage: 50 },
  { daysBeforeCheckIn: 0, refundPercentage: 10 },
];

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    user: userId,
    bookingReference: 'HOTL2345',
    status: BookingStatus.CONFIRMED,
    checkInDate: utcMidnight(10),
    checkOutDate: utcMidnight(13),
    nights: 3,
    rooms: [
      { room: new Types.ObjectId(), quantity: 1 },
      { room: new Types.ObjectId(), quantity: 1 },
    ],
    totalPrice: 540.5,
    currency: 'USD',
    payment: paymentId,
    policySnapshot: { cancellationPolicy: { tiers: TIERS } },
    ...overrides,
  };
}

function build(booking: ReturnType<typeof makeBooking> | null = makeBooking()) {
  const calls: string[] = [];
  const session = { id: 'session' };
  const bookingModel = {
    findOne: jest.fn(() => query(booking)),
    findOneAndUpdate: jest.fn(() => {
      calls.push('booking.update');
      return Promise.resolve({ ...booking, status: BookingStatus.CANCELLED });
    }),
  };
  const availabilityModel = {
    updateMany: jest.fn((filter: { date: { $in: Date[] } }) => {
      calls.push('rooms.release');
      return Promise.resolve({ modifiedCount: filter.date.$in.length });
    }),
  };
  const paymentModel = {
    findById: jest.fn(() =>
      query({
        _id: paymentId,
        status: PaymentStatus.SUCCEEDED,
        amount: 540.5,
        currency: 'USD',
      }),
    ),
  };
  const connection = {
    transaction: jest.fn(async (cb: (s: unknown) => Promise<unknown>) => {
      calls.push('tx.begin');
      const result = await cb(session);
      calls.push('tx.commit');
      return result;
    }),
  };
  const refundsService = {
    recordRefund: jest.fn((input: Record<string, unknown>) => {
      calls.push('refund.record');
      return Promise.resolve({
        _id: new Types.ObjectId(),
        status: RefundStatus.PENDING,
        ...input,
      });
    }),
    dispatchRefund: jest.fn(() => {
      calls.push('refund.dispatch');
      return Promise.resolve(true);
    }),
    findRefund: jest.fn(() => Promise.resolve(null)),
  };
  const notificationsService = {
    createNotification: jest.fn().mockResolvedValue({}),
  };
  const service = new HotelCancellationService(
    bookingModel as never,
    availabilityModel as never,
    paymentModel as never,
    connection as never,
    refundsService as never,
    notificationsService as never,
  );
  return {
    service,
    bookingModel,
    availabilityModel,
    paymentModel,
    connection,
    refundsService,
    notificationsService,
    calls,
    session,
    booking,
  };
}

const confirm = { confirm: true as const };
const id = (ctx: ReturnType<typeof build>) => ctx.booking!._id.toString();

describe('HotelCancellationService.preview', () => {
  it('shows the tier, days to check-in and refund on the full total without changing anything', async () => {
    const ctx = build();

    const preview = await ctx.service.preview(userId.toString(), id(ctx));

    expect(preview).toMatchObject({
      bookingId: id(ctx),
      status: BookingStatus.CONFIRMED,
      // check-in is UTC midnight in 10 days; the time already gone today makes it 9 whole days
      daysRemaining: 9,
      totalPrice: 540.5,
      currency: 'USD',
      tierApplied: { daysBeforeCheckIn: 7, refundPercentage: 80 },
      refundPercentage: 80,
      refundAmount: 432.4,
    });
    expect(preview.policyCalculationNotes).toContain('before check-in');
    expect(preview.checkInDate).toEqual(ctx.booking!.checkInDate);
    expect(ctx.bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(ctx.availabilityModel.updateMany).not.toHaveBeenCalled();
    expect(ctx.refundsService.recordRefund).not.toHaveBeenCalled();
  });

  describe('tier by whole days before check-in (fixed clock at UTC midnight)', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-12-01T00:00:00.000Z'));
    });
    afterEach(() => jest.useRealTimers());

    it.each([
      [20, 100, 540.5],
      [14, 100, 540.5],
      [13, 80, 432.4],
      [7, 80, 432.4],
      [6, 50, 270.25],
      [2, 50, 270.25],
      [1, 10, 54.05],
    ])(
      '%p days before check-in -> %p%% = %p',
      async (days, percentage, amount) => {
        const checkIn = new Date(Date.UTC(2026, 11, 1) + days * DAY);
        const ctx = build(
          makeBooking({
            checkInDate: checkIn,
            checkOutDate: new Date(checkIn.getTime() + 2 * DAY),
            nights: 2,
          }),
        );

        const preview = await ctx.service.preview(userId.toString(), id(ctx));

        expect(preview.daysRemaining).toBe(days);
        expect(preview.refundPercentage).toBe(percentage);
        expect(preview.refundAmount).toBe(amount);
      },
    );
  });

  it('uses the tiers copied onto the reservation, never a live policy, and 0% without a matching tier', async () => {
    const none = build(
      makeBooking({ policySnapshot: { cancellationPolicy: {} } }),
    );
    const preview = await none.service.preview(userId.toString(), id(none));
    expect(preview.refundAmount).toBe(0);
    expect(preview.tierApplied).toBeNull();
    expect(preview.policyCalculationNotes).toContain(
      'no cancellation tier applies',
    );

    const noSnapshot = build(makeBooking({ policySnapshot: undefined }));
    expect(
      (await noSnapshot.service.preview(userId.toString(), id(noSnapshot)))
        .refundAmount,
    ).toBe(0);
  });

  it("is a 404 for another user's reservation, a malformed id and an unknown id", async () => {
    const ctx = build();

    await ctx.service.preview(userId.toString(), id(ctx));
    const [filter] = ctx.bookingModel.findOne.mock.calls[0] as unknown as [
      { user: Types.ObjectId },
    ];
    expect(filter.user.equals(userId)).toBe(true); // the JWT user is part of the query
    await expect(
      ctx.service.preview(userId.toString(), 'nope'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.service.preview('nope', id(ctx))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const missing = build(null);
    await expect(
      missing.service.preview(
        userId.toString(),
        new Types.ObjectId().toString(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    [BookingStatus.PENDING_PAYMENT, new Date(Date.now() + 60_000)],
    [BookingStatus.HELD, new Date(Date.now() + 60_000)],
    [BookingStatus.PENDING_PAYMENT, new Date(Date.now() - 1000)],
    [BookingStatus.EXPIRED, undefined],
    [BookingStatus.CANCELLED, undefined],
    [BookingStatus.COMPLETED, undefined],
  ])('refuses a %s reservation (hold %s) with 409', async (status, hold) => {
    const ctx = build(makeBooking({ status, holdExpiresAt: hold }));

    await expect(
      ctx.service.preview(userId.toString(), id(ctx)),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a stored-CONFIRMED stay that is effectively COMPLETED (nothing stores COMPLETED)', async () => {
    const ctx = build(
      makeBooking({
        checkInDate: utcMidnight(-5),
        checkOutDate: utcMidnight(-2),
      }),
    );

    await expect(
      ctx.service.preview(userId.toString(), id(ctx)),
    ).rejects.toThrow(/COMPLETED reservation cannot be cancelled/);
  });

  it('blocks cancellation on or after the check-in date (stay started)', async () => {
    for (const checkIn of [utcMidnight(0), utcMidnight(-1)]) {
      const ctx = build(
        makeBooking({
          checkInDate: checkIn,
          checkOutDate: utcMidnight(3),
          nights: 3,
        }),
      );

      await expect(
        ctx.service.preview(userId.toString(), id(ctx)),
      ).rejects.toThrow(/before its check-in date/);
    }
  });
});

describe('HotelCancellationService.cancel', () => {
  it('cancels, releases the rooms and records the refund in ONE transaction, then sends it to Stripe', async () => {
    const ctx = build();

    const result = await ctx.service.cancel(userId.toString(), id(ctx), {
      ...confirm,
      reason: 'Change of plans',
    });

    expect(ctx.calls).toEqual([
      'tx.begin',
      'booking.update',
      'rooms.release',
      'rooms.release',
      'refund.record',
      'tx.commit',
      'refund.dispatch', // only after the commit
    ]);
    expect(result).toMatchObject({
      bookingId: id(ctx),
      status: BookingStatus.CANCELLED,
      refundPercentage: 80,
      refundAmount: 432.4,
      currency: 'USD',
    });
    expect(result.refund).toMatchObject({
      status: RefundStatus.PENDING,
      amount: 432.4,
      currency: 'USD',
    });
  });

  it('makes the status change a guarded conditional update: owner, CONFIRMED, check-in still ahead', async () => {
    const ctx = build();

    await ctx.service.cancel(userId.toString(), id(ctx), {
      ...confirm,
      reason: 'Change of plans',
    });

    const [filter, update, options] = ctx.bookingModel.findOneAndUpdate.mock
      .calls[0] as unknown as [
      {
        user: Types.ObjectId;
        status: BookingStatus;
        checkInDate: { $gt: Date };
      },
      { $set: Record<string, unknown> },
      { session: unknown },
    ];
    expect(filter.user.equals(userId)).toBe(true);
    expect(filter.status).toBe(BookingStatus.CONFIRMED);
    expect(filter.checkInDate.$gt).toBeInstanceOf(Date);
    expect(update.$set).toMatchObject({
      status: BookingStatus.CANCELLED,
      refundAmount: 432.4,
      cancellationReason: 'Change of plans',
    });
    expect(update.$set.cancelledAt).toBeInstanceOf(Date);
    expect(options.session).toBe(ctx.session);
  });

  it('releases the booked units of every room on every stay night, never below zero, in the transaction', async () => {
    const ctx = build();

    await ctx.service.cancel(userId.toString(), id(ctx), confirm);

    expect(ctx.availabilityModel.updateMany).toHaveBeenCalledTimes(2); // one per room
    const nights = [0, 1, 2].map((d) => utcMidnight(10 + d).toISOString());
    for (const [filter, update, options] of ctx.availabilityModel.updateMany
      .mock.calls as unknown as [
      {
        room: Types.ObjectId;
        date: { $in: Date[] };
        bookedUnits: { $gte: number };
      },
      { $inc: Record<string, number> },
      { session: unknown },
    ][]) {
      expect(filter.date.$in.map((d) => d.toISOString())).toEqual(nights); // stay nights only
      expect(filter.bookedUnits).toEqual({ $gte: 1 }); // guard: never negative
      expect(update.$inc).toEqual({ bookedUnits: -1 });
      expect(options.session).toBe(ctx.session);
    }
    const rooms = (
      ctx.availabilityModel.updateMany.mock.calls as unknown as [
        { room: Types.ObjectId },
      ][]
    ).map(([f]) => f.room.toString());
    expect(rooms).toEqual(ctx.booking!.rooms.map((r) => r.room.toString()));
  });

  it('records the refund with the payment, the amount and the notes, in the same session', async () => {
    const ctx = build();

    await ctx.service.cancel(userId.toString(), id(ctx), confirm);

    const [input, usedSession] = ctx.refundsService.recordRefund.mock
      .calls[0] as unknown as [Record<string, unknown>, unknown];
    expect(input).toMatchObject({
      payment: paymentId,
      bookingType: BookingType.HOTEL,
      bookingId: ctx.booking!._id,
      amount: 432.4,
      currency: 'USD',
      reason: 'Cancelled by the traveller',
    });
    expect(String(input.notes)).toContain('80%');
    expect(usedSession).toBe(ctx.session);
  });

  it('notifies the traveller with the refund', async () => {
    const ctx = build();

    await ctx.service.cancel(userId.toString(), id(ctx), confirm);

    expect(ctx.notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.BOOKING_CANCELLED,
        recipient: userId,
        relatedEntityType: 'HotelBooking',
        message: expect.stringContaining(
          '432.40 USD (80%) has been requested',
        ) as unknown,
      }),
    );
  });

  it('creates no refund record, no Stripe call and announces none when no tier applies (0)', async () => {
    const ctx = build(
      makeBooking({
        policySnapshot: {
          cancellationPolicy: {
            tiers: [{ daysBeforeCheckIn: 30, refundPercentage: 100 }],
          },
        },
      }),
    );

    const result = await ctx.service.cancel(
      userId.toString(),
      id(ctx),
      confirm,
    );

    expect(result.refundAmount).toBe(0);
    expect(result.refund).toBeNull();
    expect(ctx.refundsService.recordRefund).not.toHaveBeenCalled();
    expect(ctx.refundsService.dispatchRefund).not.toHaveBeenCalled();
    expect(ctx.bookingModel.findOneAndUpdate).toHaveBeenCalledTimes(1); // still cancelled
    expect(ctx.availabilityModel.updateMany).toHaveBeenCalledTimes(2); // rooms still released
    expect(ctx.notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('No refund applies') as unknown,
      }),
    );
  });

  it.each([
    PaymentStatus.REFUNDED,
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.FAILED,
  ])(
    'creates no refund AND stores/announces none when the payment is %s',
    async (status) => {
      const ctx = build();
      ctx.paymentModel.findById.mockReturnValue(
        query({ _id: paymentId, status, amount: 540.5, currency: 'USD' }),
      );

      const result = await ctx.service.cancel(
        userId.toString(),
        id(ctx),
        confirm,
      );

      expect(result).toMatchObject({
        refund: null,
        refundAmount: 0,
        refundPercentage: 0,
      });
      expect(result.policyCalculationNotes).toContain(
        'No refund could be issued',
      );
      const [, update] = ctx.bookingModel.findOneAndUpdate.mock
        .calls[0] as unknown as [unknown, { $set: { refundAmount: number } }];
      expect(update.$set.refundAmount).toBe(0);
      expect(ctx.refundsService.recordRefund).not.toHaveBeenCalled();
    },
  );

  it('reads the payment inside the transaction session', async () => {
    const ctx = build();
    const sessions: unknown[] = [];
    ctx.paymentModel.findById.mockImplementation(() =>
      query(
        {
          _id: paymentId,
          status: PaymentStatus.SUCCEEDED,
          amount: 540.5,
          currency: 'USD',
        },
        (s) => sessions.push(s),
      ),
    );

    await ctx.service.cancel(userId.toString(), id(ctx), confirm);

    expect(sessions).toEqual([ctx.session]);
  });

  it('is a 409 and changes nothing when the guarded update finds nothing (cancelled twice / stay started meanwhile)', async () => {
    const ctx = build();
    ctx.bookingModel.findOneAndUpdate.mockResolvedValue(null as never);

    await expect(
      ctx.service.cancel(userId.toString(), id(ctx), confirm),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(ctx.availabilityModel.updateMany).not.toHaveBeenCalled();
    expect(ctx.refundsService.recordRefund).not.toHaveBeenCalled();
    expect(ctx.refundsService.dispatchRefund).not.toHaveBeenCalled();
    expect(ctx.notificationsService.createNotification).not.toHaveBeenCalled();
  });

  it('does not open a transaction for a reservation that is not cancellable', async () => {
    const pending = build(
      makeBooking({
        status: BookingStatus.PENDING_PAYMENT,
        holdExpiresAt: new Date(Date.now() + 60_000),
      }),
    );
    await expect(
      pending.service.cancel(userId.toString(), id(pending), confirm),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(pending.connection.transaction).not.toHaveBeenCalled();

    const started = build(
      makeBooking({
        checkInDate: utcMidnight(0),
        checkOutDate: utcMidnight(2),
        nights: 2,
      }),
    );
    await expect(
      started.service.cancel(userId.toString(), id(started), confirm),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(started.connection.transaction).not.toHaveBeenCalled();
  });

  it('undoes the whole cancellation when recording the refund fails: no dispatch, no notification', async () => {
    const ctx = build();
    ctx.refundsService.recordRefund.mockRejectedValue(
      new Error('cannot record'),
    );

    await expect(
      ctx.service.cancel(userId.toString(), id(ctx), confirm),
    ).rejects.toThrow('cannot record');

    expect(ctx.calls).not.toContain('tx.commit');
    expect(ctx.refundsService.dispatchRefund).not.toHaveBeenCalled();
    expect(ctx.notificationsService.createNotification).not.toHaveBeenCalled();
  });

  it('asks the traveller to look again when the refund changed since the preview, and accepts the same amount', async () => {
    const ctx = build();

    await expect(
      ctx.service.cancel(userId.toString(), id(ctx), {
        ...confirm,
        expectedRefundAmount: 540.5,
      }),
    ).rejects.toThrow(/refund changed from 540.50 to 432.40/);
    expect(ctx.connection.transaction).not.toHaveBeenCalled();
    await expect(
      ctx.service.cancel(userId.toString(), id(ctx), {
        ...confirm,
        expectedRefundAmount: 432.4,
      }),
    ).resolves.toMatchObject({ refundAmount: 432.4 });
  });

  it('reports the refund status as it is after sending it to Stripe, and survives a Stripe or notification failure', async () => {
    const ok = build();
    ok.refundsService.findRefund.mockImplementation(() =>
      Promise.resolve({
        _id: new Types.ObjectId(),
        status: RefundStatus.SUCCEEDED,
        amount: 432.4,
        currency: 'USD',
      } as never),
    );
    expect(
      (await ok.service.cancel(userId.toString(), id(ok), confirm)).refund
        ?.status,
    ).toBe(RefundStatus.SUCCEEDED);

    const stripeDown = build();
    stripeDown.refundsService.dispatchRefund.mockRejectedValue(
      new Error('stripe down'),
    );
    const result = await stripeDown.service.cancel(
      userId.toString(),
      id(stripeDown),
      confirm,
    );
    expect(result.status).toBe(BookingStatus.CANCELLED);
    expect(result.refund?.status).toBe(RefundStatus.PENDING);

    const noNotify = build();
    noNotify.notificationsService.createNotification.mockRejectedValue(
      new Error('db down'),
    );
    await expect(
      noNotify.service.cancel(userId.toString(), id(noNotify), confirm),
    ).resolves.toMatchObject({ status: BookingStatus.CANCELLED });
  });

  it('works without a reason and does not store an empty one', async () => {
    const ctx = build();

    await ctx.service.cancel(userId.toString(), id(ctx), confirm);

    const [, update] = ctx.bookingModel.findOneAndUpdate.mock
      .calls[0] as unknown as [unknown, { $set: Record<string, unknown> }];
    expect(update.$set).not.toHaveProperty('cancellationReason');
  });

  it('warns (and still cancels) when fewer booked units than nights were released', async () => {
    const ctx = build();
    ctx.availabilityModel.updateMany.mockResolvedValue({ modifiedCount: 1 });

    await expect(
      ctx.service.cancel(userId.toString(), id(ctx), confirm),
    ).resolves.toMatchObject({ status: BookingStatus.CANCELLED });
    expect(ctx.availabilityModel.updateMany).toHaveBeenCalledTimes(2);
  });

  it('refunds 0% for a reservation whose snapshot has no cancellation policy at all', async () => {
    const ctx = build(makeBooking({ policySnapshot: {} }));

    const preview = await ctx.service.preview(userId.toString(), id(ctx));

    expect(preview.refundAmount).toBe(0);
    expect(preview.tierApplied).toBeNull();
  });

  it('releases the stay nights even when the stored check-in carries a time of day', async () => {
    const odd = new Date(utcMidnight(10).getTime() + 5 * 3_600_000);
    const ctx = build(makeBooking({ checkInDate: odd }));

    await ctx.service.cancel(userId.toString(), id(ctx), confirm);

    const [filter] = ctx.availabilityModel.updateMany.mock
      .calls[0] as unknown as [{ date: { $in: Date[] } }];
    expect(filter.date.$in[0].toISOString()).toBe(
      utcMidnight(10).toISOString(),
    );
  });

  it('cancels as a whole: every room of the reservation is released together', async () => {
    const three = makeBooking({
      rooms: [
        { room: new Types.ObjectId(), quantity: 1 },
        { room: new Types.ObjectId(), quantity: 1 },
        { room: new Types.ObjectId(), quantity: 1 },
      ],
    });
    const ctx = build(three);

    await ctx.service.cancel(userId.toString(), id(ctx), confirm);

    expect(ctx.availabilityModel.updateMany).toHaveBeenCalledTimes(3);
    expect(ctx.bookingModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});
