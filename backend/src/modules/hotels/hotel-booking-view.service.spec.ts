import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  BookingStatus,
  PaymentStatus,
  RefundStatus,
  Role,
} from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import {
  HotelBookingGroup,
  ListHotelBookingsQueryDto,
} from './dto/list-hotel-bookings-query.dto';
import { HotelBookingViewService } from './hotel-booking-view.service';

interface Chain<T> extends PromiseLike<T> {
  lean(): Chain<T>;
  select(): Chain<T>;
  sort(arg?: unknown): Chain<T>;
  skip(n: number): Chain<T>;
  limit(n: number): Chain<T>;
}

function query<T>(result: T) {
  const spy = { sort: undefined as unknown, skip: 0, limit: 0 };
  const q: Chain<T> & { spy: typeof spy } = {
    spy,
    lean: () => q,
    select: () => q,
    sort: (arg?: unknown) => {
      spy.sort = arg;
      return q;
    },
    skip: (n: number) => {
      spy.skip = n;
      return q;
    },
    limit: (n: number) => {
      spy.limit = n;
      return q;
    },
    then: (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return q;
}

const ownerId = new Types.ObjectId();
const hotelId = new Types.ObjectId();
const otherHotelId = new Types.ObjectId();
const paymentId = new Types.ObjectId();
const DAY = 86_400_000;
const utcMidnight = (offsetDays: number) => {
  const n = new Date();
  return new Date(
    Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) +
      offsetDays * DAY,
  );
};

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    user: ownerId,
    bookingReference: 'HOTL2345',
    hotel: hotelId,
    status: BookingStatus.CONFIRMED,
    checkInDate: utcMidnight(10),
    checkOutDate: utcMidnight(13),
    nights: 3,
    rooms: [
      {
        room: new Types.ObjectId(),
        roomName: '101',
        quantity: 1,
        averagePricePerNight: 100,
        nights: 3,
        subtotal: 300,
        guestCount: 3,
        adults: 2,
        childrenAges: [5],
      },
    ],
    guestCount: 3,
    primaryGuestName: 'Layla Hassan',
    primaryGuestEmail: 'layla@example.com',
    primaryGuestPhone: '+20 100',
    specialRequests: 'Late arrival',
    totalPrice: 300,
    currency: 'USD',
    holdExpiresAt: new Date(Date.now() + 5 * 60_000),
    policySnapshot: { checkInTime: '14:00' },
    policyAcceptedAt: new Date('2026-11-19T10:00:00Z'),
    payment: paymentId,
    confirmedAt: new Date('2026-11-19T10:05:00Z'),
    createdAt: new Date('2026-11-19T10:00:00Z'),
    updatedAt: new Date('2026-11-19T10:05:00Z'),
    ...overrides,
  };
}

function build(
  bookings: ReturnType<typeof makeBooking>[] = [makeBooking()],
  total = bookings.length,
) {
  const findQuery = query(bookings);
  const bookingModel = {
    find: jest.fn(() => findQuery),
    findById: jest.fn((id: Types.ObjectId) =>
      query(bookings.find((b) => b._id.equals(id)) ?? null),
    ),
    countDocuments: jest.fn().mockResolvedValue(total),
  };
  const hotelModel = {
    find: jest.fn(() => query([{ _id: hotelId, name: 'Nile Hotel' }])),
  };
  const paymentModel = {
    findById: jest.fn(() =>
      query({
        _id: paymentId,
        status: PaymentStatus.SUCCEEDED,
        amount: 300,
        currency: 'USD',
        paidAt: new Date('2026-11-19T10:04:00Z'),
        stripePaymentIntentId: 'pi_secret_ish',
      }),
    ),
  };
  const refundModel = { findOne: jest.fn(() => query<unknown>(null)) };
  const hotelBookingsService = {
    expireHold: jest.fn().mockResolvedValue(true),
  };
  const service = new HotelBookingViewService(
    bookingModel as never,
    hotelModel as never,
    paymentModel as never,
    refundModel as never,
    hotelBookingsService as never,
  );
  return {
    service,
    bookingModel,
    hotelModel,
    paymentModel,
    refundModel,
    hotelBookingsService,
    findQuery,
  };
}

const q = (overrides: Partial<ListHotelBookingsQueryDto> = {}) =>
  Object.assign(new ListHotelBookingsQueryDto(), overrides);

describe('HotelBookingViewService.listBookings', () => {
  it("lists only the JWT user's reservations with status, group, hotel name and rooms", async () => {
    const booking = makeBooking();
    const { service, bookingModel } = build([booking]);

    const result = await service.listBookings(ownerId.toString(), q());

    expect(result.meta).toEqual({
      page: 1,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
    expect(result.data[0]).toMatchObject({
      id: booking._id.toString(),
      bookingReference: 'HOTL2345',
      status: BookingStatus.CONFIRMED,
      group: HotelBookingGroup.UPCOMING,
      hotelName: 'Nile Hotel',
      nights: 3,
      guestCount: 3,
      totalPrice: 300,
      currency: 'USD',
      rooms: [{ roomName: '101', guestCount: 3, subtotal: 300 }],
    });
    const [filter] = bookingModel.find.mock.calls.at(-1) as unknown as [
      { user: Types.ObjectId },
    ];
    expect(filter.user.equals(ownerId)).toBe(true);
  });

  it('never leaks other fields (user id, policy, payment, contact)', async () => {
    const { service } = build();

    const json = JSON.stringify(
      await service.listBookings(ownerId.toString(), q()),
    );

    for (const secret of [
      'layla@example.com',
      '+20 100',
      'pi_secret_ish',
      ownerId.toString(),
      'policySnapshot',
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('paginates with skip/limit, a stable _id tiebreaker and the whitelisted sort', async () => {
    const { service, findQuery } = build([makeBooking()], 25);

    const result = await service.listBookings(
      ownerId.toString(),
      q({ page: 3, limit: 5, sortBy: 'checkInDate', sortOrder: 'asc' }),
    );

    expect(findQuery.spy).toMatchObject({
      skip: 10,
      limit: 5,
      sort: { checkInDate: 1, _id: 1 },
    });
    expect(result.meta).toEqual({
      page: 3,
      limit: 5,
      total: 25,
      totalPages: 5,
    });
  });

  it('refuses a sort key that is not whitelisted before it reaches Mongo', async () => {
    const { service, bookingModel } = build();

    await expect(
      service.listBookings(ownerId.toString(), q({ sortBy: 'user' as never })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bookingModel.find).not.toHaveBeenCalled();
  });

  it('builds the filter from effective statuses (a group becomes a status condition list)', async () => {
    const { service, bookingModel } = build();

    await service.listBookings(
      ownerId.toString(),
      q({ group: HotelBookingGroup.PAST }),
    );

    const calls = bookingModel.find.mock.calls as unknown as [
      { $or: Record<string, unknown>[] },
    ][];
    const filter = calls.find(([f]) => f.$or)![0];
    expect(filter.$or).toHaveLength(2); // COMPLETED + EXPIRED conditions
  });

  it('returns an empty page without querying when group and status cannot overlap', async () => {
    const { service, bookingModel } = build();

    const result = await service.listBookings(
      ownerId.toString(),
      q({
        group: HotelBookingGroup.CANCELLED,
        status: [BookingStatus.CONFIRMED],
      }),
    );

    expect(result).toEqual({
      data: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
    expect(bookingModel.countDocuments).not.toHaveBeenCalled();
  });

  it('reports a lapsed hold as EXPIRED and a finished stay as COMPLETED, each in its group', async () => {
    const lapsed = makeBooking({
      status: BookingStatus.PENDING_PAYMENT,
      holdExpiresAt: new Date(Date.now() - 1000),
    });
    const finished = makeBooking({
      checkInDate: utcMidnight(-5),
      checkOutDate: utcMidnight(-2),
    });
    const cancelled = makeBooking({ status: BookingStatus.CANCELLED });
    const { service } = build([lapsed, finished, cancelled]);

    const { data } = await service.listBookings(ownerId.toString(), q());

    expect(data.map((d) => [d.status, d.group])).toEqual([
      [BookingStatus.EXPIRED, HotelBookingGroup.PAST],
      [BookingStatus.COMPLETED, HotelBookingGroup.PAST],
      [BookingStatus.CANCELLED, HotelBookingGroup.CANCELLED],
    ]);
  });

  it("expires this user's lapsed holds first through the same expireHold the job uses", async () => {
    const lapsedId = new Types.ObjectId();
    const ctx = build();
    ctx.bookingModel.find
      .mockReturnValueOnce(query([{ _id: lapsedId }]) as never)
      .mockReturnValue(ctx.findQuery);

    await ctx.service.listBookings(ownerId.toString(), q());

    expect(ctx.hotelBookingsService.expireHold).toHaveBeenCalledWith(
      lapsedId,
      expect.any(Date),
    );
    const [lapsedFilter] = ctx.bookingModel.find.mock.calls[0] as unknown as [
      {
        user: Types.ObjectId;
        status: { $in: BookingStatus[] };
        holdExpiresAt: { $lte: Date };
      },
    ];
    expect(lapsedFilter.user.equals(ownerId)).toBe(true);
    expect(lapsedFilter.holdExpiresAt.$lte).toBeInstanceOf(Date);
  });

  it('still lists when expiring a lapsed hold fails', async () => {
    const ctx = build();
    ctx.hotelBookingsService.expireHold.mockRejectedValue(new Error('db down'));
    ctx.bookingModel.find
      .mockReturnValueOnce(query([{ _id: new Types.ObjectId() }]) as never)
      .mockReturnValue(ctx.findQuery);

    await expect(
      ctx.service.listBookings(ownerId.toString(), q()),
    ).resolves.toBeDefined();
  });

  it('gives an empty list a null hotel name map without extra queries', async () => {
    const { service, hotelModel } = build([]);

    const result = await service.listBookings(ownerId.toString(), q());

    expect(result.data).toEqual([]);
    expect(hotelModel.find).not.toHaveBeenCalled();
  });
});

describe('HotelBookingViewService.getBooking', () => {
  const owner: AuthenticatedUser = {
    userId: ownerId.toString(),
    email: 'o@example.com',
    role: Role.REGISTERED_USER,
    jti: 'j',
  };
  const moderator: AuthenticatedUser = {
    userId: new Types.ObjectId().toString(),
    email: 'm@example.com',
    role: Role.HOTEL_MODERATOR,
    jti: 'j',
    assignedProviderType: 'hotel',
    assignedProviderId: hotelId.toString(),
  };

  it('returns the owner every detail with a payment summary and no secrets', async () => {
    const booking = makeBooking();
    const { service } = build([booking]);

    const view = await service.getBooking(owner, booking._id.toString());

    expect(view).toMatchObject({
      id: booking._id.toString(),
      status: BookingStatus.CONFIRMED,
      group: HotelBookingGroup.UPCOMING,
      hotelName: 'Nile Hotel',
      primaryGuestEmail: 'layla@example.com',
      primaryGuestPhone: '+20 100',
      specialRequests: 'Late arrival',
      totalPrice: 300,
      policies: { checkInTime: '14:00' },
    });
    expect(view.rooms[0]).toMatchObject({
      roomName: '101',
      adults: 2,
      childrenAges: [5],
      subtotal: 300,
      averagePricePerNight: 100,
    });
    expect(view.payment).toEqual({
      id: paymentId.toString(),
      status: PaymentStatus.SUCCEEDED,
      amount: 300,
      currency: 'USD',
      paidAt: new Date('2026-11-19T10:04:00Z'),
    });
    const json = JSON.stringify(view);
    expect(json).not.toContain('pi_secret_ish');
    expect(json).not.toContain(ownerId.toString());
  });

  it('shows the refund of a cancelled reservation and sorts to the newest', async () => {
    const booking = makeBooking({
      status: BookingStatus.CANCELLED,
      cancelledAt: new Date('2026-11-25T08:00:00Z'),
      cancellationReason: 'Plans changed',
      refundAmount: 150,
    });
    const ctx = build([booking]);
    const refundId = new Types.ObjectId();
    ctx.refundModel.findOne.mockReturnValue(
      query({
        _id: refundId,
        status: RefundStatus.PENDING,
        amount: 150,
        currency: 'USD',
        reason: 'Cancelled by the traveller',
        policyCalculationNotes: '50%',
        stripeRefundId: 're_secret',
      }),
    );

    const view = await ctx.service.getBooking(owner, booking._id.toString());

    expect(view).toMatchObject({
      status: BookingStatus.CANCELLED,
      cancellationReason: 'Plans changed',
      refundAmount: 150,
    });
    expect(view.refund).toEqual({
      id: refundId.toString(),
      status: RefundStatus.PENDING,
      amount: 150,
      currency: 'USD',
      reason: 'Cancelled by the traveller',
      policyCalculationNotes: '50%',
      processedAt: null,
    });
    expect(JSON.stringify(view)).not.toContain('re_secret');
    const [filter] = ctx.refundModel.findOne.mock.calls[0] as unknown as [
      { bookingType: string; bookingId: Types.ObjectId },
    ];
    expect(filter.bookingType).toBe('hotel');
    expect(filter.bookingId.equals(booking._id)).toBe(true);
  });

  it('lets an admin read any reservation in full', async () => {
    const booking = makeBooking();
    const { service } = build([booking]);

    const view = await service.getBooking(
      { ...owner, userId: new Types.ObjectId().toString(), role: Role.ADMIN },
      booking._id.toString(),
    );

    expect(view.totalPrice).toBe(300);
    expect(view.primaryGuestEmail).toBe('layla@example.com');
    expect(view.payment?.status).toBe(PaymentStatus.SUCCEEDED);
  });

  it('gives the moderator of that hotel the stay facts only: no contact, prices, payment, policies or refund', async () => {
    const booking = makeBooking();
    const ctx = build([booking]);

    const view = await ctx.service.getBooking(
      moderator,
      booking._id.toString(),
    );

    expect(view).toMatchObject({
      primaryGuestName: 'Layla Hassan',
      primaryGuestEmail: null,
      primaryGuestPhone: null,
      totalPrice: null,
      policies: null,
      policyAcceptedAt: null,
      refundAmount: null,
      payment: null,
      refund: null,
    });
    expect(view.rooms[0]).toMatchObject({
      roomName: '101',
      adults: 2,
      subtotal: null,
      averagePricePerNight: null,
    });
    expect(ctx.paymentModel.findById).not.toHaveBeenCalled();
    expect(ctx.refundModel.findOne).not.toHaveBeenCalled();
  });

  it.each([
    [{ assignedProviderId: otherHotelId.toString() }],
    [{ assignedProviderId: undefined }],
    [{ assignedProviderType: 'airline' as const }],
  ])(
    'gives a moderator without that hotel assignment 404 %j',
    async (override) => {
      const booking = makeBooking();
      const { service } = build([booking]);

      await expect(
        service.getBooking(
          { ...moderator, ...override },
          booking._id.toString(),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it("is a 404 for someone else's reservation, an airline moderator, a malformed id and an unknown id", async () => {
    const booking = makeBooking();
    const { service, bookingModel } = build([booking]);

    await expect(
      service.getBooking(
        { ...owner, userId: new Types.ObjectId().toString() },
        booking._id.toString(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.getBooking(
        { ...owner, role: Role.AIRLINE_MODERATOR },
        booking._id.toString(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getBooking(owner, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(bookingModel.findById).toHaveBeenCalledTimes(2);
    await expect(
      service.getBooking(owner, new Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('has no payment summary when the payment record is missing', async () => {
    const booking = makeBooking();
    const ctx = build([booking]);
    ctx.paymentModel.findById.mockReturnValue(query(null) as never);

    const view = await ctx.service.getBooking(owner, booking._id.toString());

    expect(view.payment).toBeNull();
  });

  it('a stay is CONFIRMED on its check-out day and COMPLETED from the next UTC day', async () => {
    const onDay = makeBooking({
      checkInDate: utcMidnight(-3),
      checkOutDate: utcMidnight(0),
    });
    const dayAfter = makeBooking({
      checkInDate: utcMidnight(-4),
      checkOutDate: utcMidnight(-1),
    });
    const { service } = build([onDay, dayAfter]);

    expect((await service.getBooking(owner, onDay._id.toString())).status).toBe(
      BookingStatus.CONFIRMED,
    );
    expect(
      (await service.getBooking(owner, dayAfter._id.toString())).status,
    ).toBe(BookingStatus.COMPLETED);
  });

  it('has no payment or refund before paying starts, and reports a lapsed hold as EXPIRED', async () => {
    const booking = makeBooking({
      status: BookingStatus.PENDING_PAYMENT,
      payment: null,
      holdExpiresAt: new Date(Date.now() - 1000),
      confirmedAt: undefined,
      policyAcceptedAt: undefined,
    });
    const { service, paymentModel } = build([booking]);

    const view = await service.getBooking(owner, booking._id.toString());

    expect(view.status).toBe(BookingStatus.EXPIRED);
    expect(view.group).toBe(HotelBookingGroup.PAST);
    expect(view.payment).toBeNull();
    expect(view.confirmedAt).toBeNull();
    expect(paymentModel.findById).not.toHaveBeenCalled();
  });
});
