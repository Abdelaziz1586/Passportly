import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  BookingStatus,
  BookingType,
  CabinClass,
  NotificationType,
  PaymentStatus,
  RefundStatus,
  TripType,
} from '../../common/enums';
import { FlightCancellationService } from './flight-cancellation.service';

interface Chain<T> extends PromiseLike<T> {
  lean(): Chain<T>;
}

function query<T>(result: T): Chain<T> {
  const q: Chain<T> = {
    lean: () => q,
    then: (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return q;
}

const userId = new Types.ObjectId();
const paymentId = new Types.ObjectId();
const DAY = 86_400_000;

const TIERS = [
  { daysBeforeDeparture: 14, refundPercentage: 100 },
  { daysBeforeDeparture: 7, refundPercentage: 80 },
  { daysBeforeDeparture: 2, refundPercentage: 50 },
  { daysBeforeDeparture: 0, refundPercentage: 10 },
];

function makeBooking(overrides: Record<string, unknown> = {}) {
  const departure = new Date(Date.now() + 10 * DAY + 5 * 3_600_000);
  return {
    _id: new Types.ObjectId(),
    user: userId,
    bookingReference: 'ABCD2345',
    status: BookingStatus.CONFIRMED,
    tripType: TripType.ONE_WAY,
    legs: [
      {
        cabin: new Types.ObjectId(),
        cabinClass: CabinClass.ECONOMY,
        departureTime: departure,
        arrivalTime: new Date(departure.getTime() + 4 * 3_600_000),
      },
    ],
    passengerCounts: {
      adults: 2,
      children: 0,
      infants: 0,
      totalSeatsRequired: 2,
    },
    totalPrice: 340.5,
    currency: 'USD',
    payment: paymentId,
    policySnapshot: { legs: [{ cancellationPolicy: { tiers: TIERS } }] },
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
  const cabinModel = {
    updateOne: jest.fn(() => {
      calls.push('cabin.update');
      return Promise.resolve({ modifiedCount: 1 });
    }),
  };
  const paymentModel = {
    findById: jest.fn(() =>
      query({
        _id: paymentId,
        status: PaymentStatus.SUCCEEDED,
        amount: 340.5,
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
  const service = new FlightCancellationService(
    bookingModel as never,
    cabinModel as never,
    paymentModel as never,
    connection as never,
    refundsService as never,
    notificationsService as never,
  );
  return {
    service,
    bookingModel,
    cabinModel,
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

describe('FlightCancellationService.preview', () => {
  it('shows the tier, days left and refund amount without changing anything', async () => {
    const { service, bookingModel, cabinModel, refundsService, booking } =
      build();

    const preview = await service.preview(
      userId.toString(),
      booking!._id.toString(),
    );

    expect(preview).toMatchObject({
      bookingId: booking!._id.toString(),
      bookingReference: 'ABCD2345',
      status: BookingStatus.CONFIRMED,
      daysRemaining: 10,
      totalPrice: 340.5,
      currency: 'USD',
      tierApplied: { daysBeforeDeparture: 7, refundPercentage: 80 },
      refundPercentage: 80,
      refundAmount: 272.4,
    });
    expect(preview.policyCalculationNotes).toContain(
      'tier of 7+ day(s) applies, 80%',
    );
    expect(preview.departureTime).toEqual(booking!.legs[0].departureTime);
    expect(bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(cabinModel.updateOne).not.toHaveBeenCalled();
    expect(refundsService.recordRefund).not.toHaveBeenCalled();
  });

  it.each([
    [20, 100, 340.5],
    [14, 100, 340.5],
    [13, 80, 272.4],
    [3, 50, 170.25],
    [1, 10, 34.05],
  ])(
    '%p days before departure -> %p%% = %p',
    async (days, percentage, amount) => {
      const departure = new Date(Date.now() + days * DAY + 3_600_000);
      const { service, booking } = build(
        makeBooking({
          legs: [{ ...makeBooking().legs[0], departureTime: departure }],
        }),
      );

      const preview = await service.preview(
        userId.toString(),
        booking!._id.toString(),
      );

      expect(preview.refundPercentage).toBe(percentage);
      expect(preview.refundAmount).toBe(amount);
    },
  );

  it('uses the tiers copied onto the booking and the OUTBOUND flight for a round trip', async () => {
    const outbound = new Date(Date.now() + 3 * DAY + 3_600_000);
    const inbound = new Date(Date.now() + 30 * DAY);
    const { service, booking } = build(
      makeBooking({
        tripType: TripType.ROUND_TRIP,
        legs: [
          { ...makeBooking().legs[0], departureTime: outbound },
          { ...makeBooking().legs[0], departureTime: inbound },
        ],
        policySnapshot: {
          legs: [
            { cancellationPolicy: { tiers: TIERS } },
            {
              cancellationPolicy: {
                tiers: [{ daysBeforeDeparture: 0, refundPercentage: 0 }],
              },
            },
          ],
        },
      }),
    );

    const preview = await service.preview(
      userId.toString(),
      booking!._id.toString(),
    );

    expect(preview.daysRemaining).toBe(3);
    expect(preview.refundPercentage).toBe(50);
    expect(preview.departureTime).toEqual(outbound);
  });

  it('refunds 0% when the booking has no tier that applies (or no tiers at all)', async () => {
    const none = build(
      makeBooking({ policySnapshot: { legs: [{ cancellationPolicy: {} }] } }),
    );
    const preview = await none.service.preview(
      userId.toString(),
      none.booking!._id.toString(),
    );
    expect(preview.refundAmount).toBe(0);
    expect(preview.tierApplied).toBeNull();
    expect(preview.policyCalculationNotes).toContain(
      'no cancellation tier applies',
    );

    const noSnapshot = build(makeBooking({ policySnapshot: undefined }));
    expect(
      (
        await noSnapshot.service.preview(
          userId.toString(),
          noSnapshot.booking!._id.toString(),
        )
      ).refundAmount,
    ).toBe(0);
  });

  it("is a 404 for someone else's booking, a malformed id and an unknown id", async () => {
    const { service, bookingModel, booking } = build();

    await expect(
      service.preview(new Types.ObjectId().toString(), booking!._id.toString()),
    ).resolves.toBeDefined(); // the fake model ignores the owner filter ...
    const [filter] = bookingModel.findOne.mock.calls[0] as unknown as [
      { user: Types.ObjectId },
    ];
    // ... so assert the owner is part of the query (the JWT user, never client input)
    expect(filter.user.equals(new Types.ObjectId(filter.user.toString()))).toBe(
      true,
    );
    await expect(
      service.preview(userId.toString(), 'nope'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.preview('nope', booking!._id.toString()),
    ).rejects.toBeInstanceOf(NotFoundException);
    const missing = build(null);
    await expect(
      missing.service.preview(
        userId.toString(),
        new Types.ObjectId().toString(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    BookingStatus.PENDING_PAYMENT,
    BookingStatus.HELD,
    BookingStatus.EXPIRED,
    BookingStatus.CANCELLED,
    BookingStatus.COMPLETED,
  ])('refuses a %s booking with 409', async (status) => {
    const { service, booking } = build(makeBooking({ status }));

    await expect(
      service.preview(userId.toString(), booking!._id.toString()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks cancellation once the outbound flight has departed', async () => {
    const { service, booking } = build(
      makeBooking({
        legs: [
          { ...makeBooking().legs[0], departureTime: new Date(Date.now() - 1) },
        ],
      }),
    );

    await expect(
      service.preview(userId.toString(), booking!._id.toString()),
    ).rejects.toThrow(/after departure/);
  });
});

describe('FlightCancellationService.cancel', () => {
  it('cancels, returns the seats and records the refund in ONE transaction, then sends it to Stripe', async () => {
    const ctx = build();
    const { service, calls, booking } = ctx;

    const result = await service.cancel(
      userId.toString(),
      booking!._id.toString(),
      {
        ...confirm,
        reason: 'Change of plans',
      },
    );

    expect(calls).toEqual([
      'tx.begin',
      'booking.update',
      'cabin.update',
      'refund.record',
      'tx.commit',
      'refund.dispatch', // only after the commit
    ]);
    expect(result).toMatchObject({
      bookingId: booking!._id.toString(),
      status: BookingStatus.CANCELLED,
      refundPercentage: 80,
      refundAmount: 272.4,
      currency: 'USD',
    });
    expect(result.refund).toMatchObject({
      status: RefundStatus.PENDING,
      amount: 272.4,
      currency: 'USD',
    });
    expect(result.cancelledAt).toBeInstanceOf(Date);
  });

  it('makes the status change a guarded conditional update: owner, CONFIRMED, not departed', async () => {
    const { service, bookingModel, booking } = build();

    await service.cancel(userId.toString(), booking!._id.toString(), {
      ...confirm,
      reason: 'Change of plans',
    });

    const [filter, update, options] = bookingModel.findOneAndUpdate.mock
      .calls[0] as unknown as [
      {
        _id: Types.ObjectId;
        user: Types.ObjectId;
        status: BookingStatus;
        'legs.0.departureTime': { $gt: Date };
      },
      { $set: Record<string, unknown> },
      { session: unknown },
    ];
    expect(filter.user.equals(userId)).toBe(true);
    expect(filter.status).toBe(BookingStatus.CONFIRMED);
    expect(filter['legs.0.departureTime'].$gt).toBeInstanceOf(Date);
    expect(update.$set).toMatchObject({
      status: BookingStatus.CANCELLED,
      refundAmount: 272.4,
      cancellationReason: 'Change of plans',
    });
    expect(update.$set.cancelledAt).toBeInstanceOf(Date);
    expect(options.session).toBeDefined();
  });

  it("returns every leg's seats to its cabin inside the transaction", async () => {
    const second = new Types.ObjectId();
    const ctx = build(
      makeBooking({
        tripType: TripType.ROUND_TRIP,
        legs: [
          makeBooking().legs[0],
          { ...makeBooking().legs[0], cabin: second },
        ],
      }),
    );

    await ctx.service.cancel(
      userId.toString(),
      ctx.booking!._id.toString(),
      confirm,
    );

    expect(ctx.cabinModel.updateOne).toHaveBeenCalledTimes(2);
    for (const [filter, update, options] of ctx.cabinModel.updateOne.mock
      .calls as unknown as [
      { _id: Types.ObjectId },
      { $inc: Record<string, number> },
      { session: unknown },
    ][]) {
      expect(update.$inc).toEqual({ availableSeats: 2 }); // the booked seats come back
      expect(options.session).toBe(ctx.session);
      expect(
        [ctx.booking!.legs[0].cabin, second].some((c) => c.equals(filter._id)),
      ).toBe(true);
    }
  });

  it('records the refund with the payment, the amount and how it was computed, in the same session', async () => {
    const { service, refundsService, booking, session } = build();

    await service.cancel(userId.toString(), booking!._id.toString(), confirm);

    const [input, usedSession] = refundsService.recordRefund.mock
      .calls[0] as unknown as [Record<string, unknown>, unknown];
    expect(input).toMatchObject({
      payment: paymentId,
      user: expect.any(Types.ObjectId) as unknown,
      bookingType: BookingType.FLIGHT,
      bookingId: booking!._id,
      amount: 272.4,
      currency: 'USD',
      reason: 'Cancelled by the traveller',
    });
    expect(String(input.notes)).toContain('80%');
    expect(usedSession).toBe(session);
  });

  it('notifies the traveller with the refund', async () => {
    const { service, notificationsService, booking } = build();

    await service.cancel(userId.toString(), booking!._id.toString(), confirm);

    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.BOOKING_CANCELLED,
        recipient: userId,
        message: expect.stringContaining('272.40 USD (80%)') as unknown,
      }),
    );
  });

  it('creates no refund record and no Stripe call when the refund is 0', async () => {
    const departure = new Date(Date.now() + 5 * 3_600_000);
    const ctx = build(
      makeBooking({
        legs: [{ ...makeBooking().legs[0], departureTime: departure }],
        policySnapshot: {
          legs: [
            {
              cancellationPolicy: {
                tiers: [{ daysBeforeDeparture: 2, refundPercentage: 50 }],
              },
            },
          ],
        },
      }),
    );

    const result = await ctx.service.cancel(
      userId.toString(),
      ctx.booking!._id.toString(),
      confirm,
    );

    expect(result.refundAmount).toBe(0);
    expect(result.refund).toBeNull();
    expect(ctx.refundsService.recordRefund).not.toHaveBeenCalled();
    expect(ctx.refundsService.dispatchRefund).not.toHaveBeenCalled();
    // still cancelled, seats still back
    expect(ctx.bookingModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(ctx.cabinModel.updateOne).toHaveBeenCalledTimes(1);
    expect(ctx.notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('No refund applies') as unknown,
      }),
    );
  });

  it('creates no refund when the payment did not succeed (nothing to give back)', async () => {
    const ctx = build();
    ctx.paymentModel.findById.mockReturnValue(
      query({
        _id: paymentId,
        status: PaymentStatus.REFUNDED,
        amount: 340.5,
        currency: 'USD',
      }),
    );

    const result = await ctx.service.cancel(
      userId.toString(),
      ctx.booking!._id.toString(),
      confirm,
    );

    expect(result.refund).toBeNull();
    expect(ctx.refundsService.recordRefund).not.toHaveBeenCalled();
  });

  it('is a 409 and changes nothing when the guarded update finds nothing (already cancelled / departed meanwhile)', async () => {
    const ctx = build();
    ctx.bookingModel.findOneAndUpdate.mockResolvedValue(null as never);

    await expect(
      ctx.service.cancel(
        userId.toString(),
        ctx.booking!._id.toString(),
        confirm,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(ctx.cabinModel.updateOne).not.toHaveBeenCalled();
    expect(ctx.refundsService.recordRefund).not.toHaveBeenCalled();
    expect(ctx.refundsService.dispatchRefund).not.toHaveBeenCalled();
    expect(ctx.notificationsService.createNotification).not.toHaveBeenCalled();
  });

  it('does not touch anything for a booking that is not CONFIRMED or has departed', async () => {
    const pending = build(
      makeBooking({ status: BookingStatus.PENDING_PAYMENT }),
    );
    await expect(
      pending.service.cancel(
        userId.toString(),
        pending.booking!._id.toString(),
        confirm,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(pending.connection.transaction).not.toHaveBeenCalled();

    const departed = build(
      makeBooking({
        legs: [
          {
            ...makeBooking().legs[0],
            departureTime: new Date(Date.now() - 1000),
          },
        ],
      }),
    );
    await expect(
      departed.service.cancel(
        userId.toString(),
        departed.booking!._id.toString(),
        confirm,
      ),
    ).rejects.toThrow(/after departure/);
    expect(departed.connection.transaction).not.toHaveBeenCalled();
  });

  it('reports the refund status as it is after sending it to Stripe', async () => {
    const ctx = build();
    ctx.refundsService.findRefund.mockImplementation(() =>
      Promise.resolve({
        _id: new Types.ObjectId(),
        status: RefundStatus.SUCCEEDED,
        amount: 272.4,
        currency: 'USD',
      } as never),
    );

    const result = await ctx.service.cancel(
      userId.toString(),
      ctx.booking!._id.toString(),
      confirm,
    );

    expect(result.refund?.status).toBe(RefundStatus.SUCCEEDED);
  });

  it('still cancels when sending the refund to Stripe fails (the job retries)', async () => {
    const ctx = build();
    ctx.refundsService.dispatchRefund.mockRejectedValue(
      new Error('stripe down'),
    );

    const result = await ctx.service.cancel(
      userId.toString(),
      ctx.booking!._id.toString(),
      confirm,
    );

    expect(result.status).toBe(BookingStatus.CANCELLED);
    expect(result.refund?.status).toBe(RefundStatus.PENDING);
  });

  it('still cancels when the notification fails', async () => {
    const ctx = build();
    ctx.notificationsService.createNotification.mockRejectedValue(
      new Error('db down'),
    );

    await expect(
      ctx.service.cancel(
        userId.toString(),
        ctx.booking!._id.toString(),
        confirm,
      ),
    ).resolves.toMatchObject({ status: BookingStatus.CANCELLED });
  });

  it('works without a reason and does not store an empty one', async () => {
    const { service, bookingModel, booking } = build();

    await service.cancel(userId.toString(), booking!._id.toString(), confirm);

    const [, update] = bookingModel.findOneAndUpdate.mock
      .calls[0] as unknown as [unknown, { $set: Record<string, unknown> }];
    expect(update.$set).not.toHaveProperty('cancellationReason');
  });
});
