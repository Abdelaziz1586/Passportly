import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus } from '../../common/enums';
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
  const hotelBookingsService = {
    expireHold: jest.fn().mockResolvedValue(true),
  };
  const service = new HotelBookingViewService(
    bookingModel as never,
    hotelModel as never,
    hotelBookingsService as never,
  );
  return {
    service,
    bookingModel,
    hotelModel,
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
