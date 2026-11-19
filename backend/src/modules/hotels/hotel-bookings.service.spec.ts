import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus, NotificationType } from '../../common/enums';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import {
  HOTEL_HOLD_MINUTES,
  HotelBookingsService,
  MAX_STAY_NIGHTS,
} from './hotel-bookings.service';

interface Chain<T> extends PromiseLike<T> {
  lean(): Chain<T>;
  session(): Chain<T>;
  select(): Chain<T>;
  limit(): Chain<T>;
}

function query<T>(result: T): Chain<T> {
  const q: Chain<T> = {
    lean: () => q,
    session: () => q,
    select: () => q,
    limit: () => q,
    then: (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return q;
}

const userId = new Types.ObjectId();
const DAY = 86_400_000;
const utcMidnight = (offsetDays: number) => {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) +
      offsetDays * DAY,
  );
};
const ymd = (date: Date) => date.toISOString().slice(0, 10);

const hotel = {
  _id: new Types.ObjectId(),
  name: 'Nile Hotel',
  isActive: true,
  policies: {
    checkInTime: '14:00',
    checkOutTime: '12:00',
    allowCancellation: true,
    cancellationTiers: [
      { daysBeforeCheckIn: 7, refundPercentage: 100 },
      { daysBeforeCheckIn: 2, refundPercentage: 50 },
    ],
  },
};

function makeRoom(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    hotel: hotel._id,
    name: '101',
    maxOccupancy: 3,
    basePricePerNight: 100,
    currency: 'USD',
    isActive: true,
    ...overrides,
  };
}

function nightsRows(
  room: { _id: Types.ObjectId },
  checkIn: Date,
  nights: number,
  overrides: Record<string, unknown> = {},
) {
  return Array.from({ length: nights }, (_v, i) => ({
    _id: new Types.ObjectId(),
    room: room._id,
    date: new Date(checkIn.getTime() + i * DAY),
    totalUnits: 1,
    bookedUnits: 0,
    heldUnits: 0,
    isBlocked: false,
    ...overrides,
  }));
}

function build(
  rooms: ReturnType<typeof makeRoom>[],
  rowsByRoom: Record<string, unknown[]>,
) {
  const hotelModel = { findById: jest.fn(() => query<unknown>(hotel)) };
  const roomModel = { find: jest.fn(() => query<unknown>(rooms)) };
  const availabilityModel = {
    find: jest.fn((filter: { room: Types.ObjectId }) =>
      query<unknown>(rowsByRoom[filter.room.toString()] ?? []),
    ),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    updateMany: jest.fn((filter: { _id: { $in: unknown[] } }) =>
      Promise.resolve({ modifiedCount: filter._id.$in.length }),
    ),
  };
  const bookingModel = {
    create: jest.fn((docs: Record<string, unknown>[]) =>
      Promise.resolve(
        docs.map((doc) => ({
          _id: new Types.ObjectId(),
          createdAt: new Date(),
          ...doc,
        })),
      ),
    ),
    find: jest.fn(() => query<unknown>([])),
    findOneAndUpdate: jest.fn(),
  };
  const session = { id: 'session' };
  const connection = {
    transaction: jest.fn((cb: (s: unknown) => Promise<unknown>) => cb(session)),
  };
  const notificationsService = {
    createNotification: jest.fn().mockResolvedValue({}),
  };
  const service = new HotelBookingsService(
    hotelModel as never,
    roomModel as never,
    availabilityModel as never,
    bookingModel as never,
    connection as never,
    notificationsService as never,
  );
  return {
    service,
    hotelModel,
    roomModel,
    availabilityModel,
    bookingModel,
    connection,
    notificationsService,
    session,
  };
}

function dto(
  rooms: ReturnType<typeof makeRoom>[],
  overrides: Partial<CreateHotelBookingDto> = {},
): CreateHotelBookingDto {
  return {
    hotelId: hotel._id.toString(),
    checkInDate: ymd(utcMidnight(10)),
    checkOutDate: ymd(utcMidnight(13)),
    rooms: rooms.map((room) => ({
      roomId: room._id.toString(),
      adults: 2,
      childrenAges: [],
    })),
    primaryGuestName: 'Layla Hassan',
    primaryGuestEmail: 'layla@example.com',
    ...overrides,
  };
}

describe('HotelBookingsService.createBooking', () => {
  it('holds every night of one room and prices it at the room price (HTL-16, HTL-18)', async () => {
    const room = makeRoom();
    const rows = nightsRows(room, utcMidnight(10), 3);
    const ctx = build([room], { [room._id.toString()]: rows });
    const before = Date.now();

    const booking = await ctx.service.createBooking(
      userId.toString(),
      dto([room]),
    );

    expect(booking).toMatchObject({
      status: BookingStatus.PENDING_PAYMENT,
      hotelId: hotel._id.toString(),
      hotelName: 'Nile Hotel',
      nights: 3,
      guestCount: 2,
      totalPrice: 300,
      currency: 'USD',
      primaryGuestName: 'Layla Hassan',
      primaryGuestEmail: 'layla@example.com',
    });
    expect(booking.rooms).toEqual([
      {
        roomId: room._id.toString(),
        roomName: '101',
        adults: 2,
        childrenAges: [],
        guestCount: 2,
        nights: 3,
        averagePricePerNight: 100,
        subtotal: 300,
      },
    ]);
    // the hold is 10 minutes from the request and never extended
    const hold = booking.holdExpiresAt!.getTime();
    expect(hold).toBeGreaterThanOrEqual(
      before + HOTEL_HOLD_MINUTES * 60_000 - 50,
    );
    expect(hold).toBeLessThanOrEqual(
      Date.now() + HOTEL_HOLD_MINUTES * 60_000 + 50,
    );
    // ONE conditional bulk update for the room covering its three nights, inside the transaction
    expect(ctx.availabilityModel.updateMany).toHaveBeenCalledTimes(1);
    const [filter, update, options] = ctx.availabilityModel.updateMany.mock
      .calls[0] as unknown as [
      { _id: { $in: Types.ObjectId[] }; isBlocked: unknown; $expr: unknown },
      { $inc: Record<string, number> },
      { session: unknown },
    ];
    expect(filter._id.$in.map(String)).toEqual(
      rows.map((row) => String(row._id)),
    );
    expect(filter.isBlocked).toEqual({ $ne: true });
    // a missing counter counts as 0, so it can never make the check vacuously true
    expect(filter.$expr).toEqual({
      $lte: [
        {
          $add: [
            { $ifNull: ['$bookedUnits', 0] },
            { $ifNull: ['$heldUnits', 0] },
            1,
          ],
        },
        '$totalUnits',
      ],
    });
    expect(update.$inc).toEqual({ heldUnits: 1 });
    expect(options.session).toBe(ctx.session);
  });

  it('owner comes from the JWT user id, the hotel policies are copied onto the reservation', async () => {
    const room = makeRoom();
    const ctx = build([room], {
      [room._id.toString()]: nightsRows(room, utcMidnight(10), 3),
    });

    const booking = await ctx.service.createBooking(
      userId.toString(),
      dto([room]),
    );

    const [docs] = ctx.bookingModel.create.mock.calls[0] as unknown as [
      {
        user: Types.ObjectId;
        policySnapshot: Record<string, unknown>;
        status: BookingStatus;
      }[],
    ];
    expect(docs[0].user.equals(userId)).toBe(true);
    expect(docs[0].status).toBe(BookingStatus.PENDING_PAYMENT);
    expect(booking.policies).toMatchObject({
      hotelName: 'Nile Hotel',
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationPolicy: {
        tiers: [
          { daysBeforeCheckIn: 7, refundPercentage: 100 },
          { daysBeforeCheckIn: 2, refundPercentage: 50 },
        ],
      },
    });
    expect(booking.bookingReference).toMatch(/^[A-Z2-9]{8}$/);
  });

  it("reserves several rooms in ONE reservation: total = sum over rooms of nights x that room's price", async () => {
    const a = makeRoom({ name: '101', basePricePerNight: 100 });
    const b = makeRoom({
      name: '102',
      basePricePerNight: 80.5,
      maxOccupancy: 4,
    });
    const ctx = build([a, b], {
      [a._id.toString()]: nightsRows(a, utcMidnight(10), 3),
      [b._id.toString()]: nightsRows(b, utcMidnight(10), 3),
    });

    const booking = await ctx.service.createBooking(
      userId.toString(),
      dto([a, b], {
        rooms: [
          { roomId: a._id.toString(), adults: 1, childrenAges: [4] },
          { roomId: b._id.toString(), adults: 2, childrenAges: [9, 12] },
        ],
      }),
    );

    expect(booking.totalPrice).toBe(541.5); // 300 + 3 x 80.5
    expect(booking.guestCount).toBe(6);
    expect(
      booking.rooms.map((r) => [
        r.roomName,
        r.subtotal,
        r.adults,
        r.childrenAges,
      ]),
    ).toEqual([
      ['101', 300, 1, [4]],
      ['102', 241.5, 2, [9, 12]],
    ]);
    expect(ctx.availabilityModel.updateMany).toHaveBeenCalledTimes(2); // one bulk update per room
    expect(ctx.bookingModel.create).toHaveBeenCalledTimes(1); // one reservation
    expect(ctx.connection.transaction).toHaveBeenCalledTimes(1); // one transaction
  });

  it("uses a night's price override over the room's base price and averages the nights", async () => {
    const room = makeRoom({ basePricePerNight: 100 });
    const rows = nightsRows(room, utcMidnight(10), 3);
    rows[1] = { ...rows[1], priceOverride: 160 } as never;
    const ctx = build([room], { [room._id.toString()]: rows });

    const booking = await ctx.service.createBooking(
      userId.toString(),
      dto([room]),
    );

    expect(booking.totalPrice).toBe(360); // 100 + 160 + 100
    expect(booking.rooms[0].subtotal).toBe(360);
    expect(booking.rooms[0].averagePricePerNight).toBe(120);
  });

  it('prices from the stored data only: nothing money-related is read from the request', async () => {
    const room = makeRoom();
    const ctx = build([room], {
      [room._id.toString()]: nightsRows(room, utcMidnight(10), 3),
    });
    const forged = {
      ...dto([room]),
      totalPrice: 1,
      status: 'CONFIRMED',
      user: 'x',
    } as unknown as CreateHotelBookingDto;

    const booking = await ctx.service.createBooking(userId.toString(), forged);

    expect(booking.totalPrice).toBe(300);
    const [docs] = ctx.bookingModel.create.mock.calls[0] as unknown as [
      { status: BookingStatus; user: Types.ObjectId }[],
    ];
    expect(docs[0].status).toBe(BookingStatus.PENDING_PAYMENT);
    expect(docs[0].user.equals(userId)).toBe(true);
  });

  describe('all or nothing (HTL-18)', () => {
    it.each([
      [
        'a night has no availability row (not bookable)',
        (rows: unknown[]) => rows.slice(0, 2),
      ],
      [
        'a night is blocked',
        (rows: Record<string, unknown>[]) =>
          rows.map((r, i) => (i === 1 ? { ...r, isBlocked: true } : r)),
      ],
    ])(
      'rejects with 409 when %s, holding nothing and writing nothing',
      async (_label, mutate) => {
        const room = makeRoom();
        const rows = mutate(nightsRows(room, utcMidnight(10), 3));
        const ctx = build([room], { [room._id.toString()]: rows });

        await expect(
          ctx.service.createBooking(userId.toString(), dto([room])),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(ctx.availabilityModel.updateOne).not.toHaveBeenCalled();
        expect(ctx.bookingModel.create).not.toHaveBeenCalled();
      },
    );

    it('rejects the whole reservation when ONE night of ONE room cannot be held (full, held or booked)', async () => {
      const a = makeRoom({ name: '101' });
      const b = makeRoom({ name: '102' });
      const ctx = build([a, b], {
        [a._id.toString()]: nightsRows(a, utcMidnight(10), 3),
        [b._id.toString()]: nightsRows(b, utcMidnight(10), 3),
      });
      // room a: all 3 nights taken; room b: only 2 of its 3 nights could take the unit (one is held by someone else)
      ctx.availabilityModel.updateMany
        .mockResolvedValueOnce({ modifiedCount: 3 })
        .mockResolvedValueOnce({ modifiedCount: 2 });

      await expect(
        ctx.service.createBooking(userId.toString(), dto([a, b])),
      ).rejects.toThrow(/Room 102 is no longer available/);

      // no reservation is written; the transaction aborts, which undoes the held units
      expect(ctx.bookingModel.create).not.toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    const base = () => {
      const room = makeRoom();
      return {
        room,
        ctx: build([room], {
          [room._id.toString()]: nightsRows(room, utcMidnight(10), 3),
        }),
      };
    };

    it.each([
      ['check-out not after check-in', { checkOutDate: ymd(utcMidnight(10)) }],
      ['check-out before check-in', { checkOutDate: ymd(utcMidnight(9)) }],
      [
        'check-in in the past',
        {
          checkInDate: ymd(utcMidnight(-1)),
          checkOutDate: ymd(utcMidnight(2)),
        },
      ],
      ['an impossible date', { checkInDate: '2027-02-30' }],
      [
        'a stay longer than the sanity limit',
        { checkOutDate: ymd(utcMidnight(10 + MAX_STAY_NIGHTS + 1)) },
      ],
    ])(
      'rejects %s with 400 before touching the database',
      async (_label, override) => {
        const { room, ctx } = base();

        await expect(
          ctx.service.createBooking(userId.toString(), dto([room], override)),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(ctx.hotelModel.findById).not.toHaveBeenCalled();
        expect(ctx.connection.transaction).not.toHaveBeenCalled();
      },
    );

    it('accepts check-in today (UTC) and a one-night stay', async () => {
      const room = makeRoom();
      const ctx = build([room], {
        [room._id.toString()]: nightsRows(room, utcMidnight(0), 1),
      });

      const booking = await ctx.service.createBooking(
        userId.toString(),
        dto([room], {
          checkInDate: ymd(utcMidnight(0)),
          checkOutDate: ymd(utcMidnight(1)),
        }),
      );

      expect(booking.nights).toBe(1);
    });

    it('rejects a reservation without an adult, an empty room, and the same room twice', async () => {
      const { room, ctx } = base();
      const id = room._id.toString();

      await expect(
        ctx.service.createBooking(
          userId.toString(),
          dto([room], {
            rooms: [{ roomId: id, adults: 0, childrenAges: [5] }],
          }),
        ),
      ).rejects.toThrow(/at least one adult/);
      await expect(
        ctx.service.createBooking(
          userId.toString(),
          dto([room], { rooms: [{ roomId: id, adults: 0, childrenAges: [] }] }),
        ),
      ).rejects.toThrow(/at least one guest/);
      await expect(
        ctx.service.createBooking(
          userId.toString(),
          dto([room], {
            rooms: [
              { roomId: id, adults: 1 },
              { roomId: id, adults: 1 },
            ],
          }),
        ),
      ).rejects.toThrow(/only be selected once/);
    });

    it('allows a room with only children as long as another room has an adult', async () => {
      const a = makeRoom({ name: '101' });
      const b = makeRoom({ name: '102' });
      const ctx = build([a, b], {
        [a._id.toString()]: nightsRows(a, utcMidnight(10), 3),
        [b._id.toString()]: nightsRows(b, utcMidnight(10), 3),
      });

      await expect(
        ctx.service.createBooking(
          userId.toString(),
          dto([a, b], {
            rooms: [
              { roomId: a._id.toString(), adults: 1 },
              { roomId: b._id.toString(), adults: 0, childrenAges: [16] },
            ],
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('rejects a room above its maximum occupancy (adults + children)', async () => {
      const { room, ctx } = base(); // sleeps 3

      await expect(
        ctx.service.createBooking(
          userId.toString(),
          dto([room], {
            rooms: [
              { roomId: room._id.toString(), adults: 2, childrenAges: [3, 4] },
            ],
          }),
        ),
      ).rejects.toThrow(/sleeps at most 3 \(4 assigned\)/);
      expect(ctx.connection.transaction).not.toHaveBeenCalled();
    });

    it('is a 404 for an unknown hotel, and for a room that is not an active room of that hotel', async () => {
      const room = makeRoom();
      const noHotel = build([room], {});
      noHotel.hotelModel.findById.mockReturnValue(query(null));
      await expect(
        noHotel.service.createBooking(userId.toString(), dto([room])),
      ).rejects.toBeInstanceOf(NotFoundException);

      const noRoom = build([], {}); // the room query (hotel + active filter) finds nothing
      await expect(
        noRoom.service.createBooking(userId.toString(), dto([room])),
      ).rejects.toBeInstanceOf(NotFoundException);
      const [filter] = noRoom.roomModel.find.mock.calls[0] as unknown as [
        { hotel: Types.ObjectId; isActive: boolean },
      ];
      expect(filter.hotel.equals(hotel._id)).toBe(true);
      expect(filter.isActive).toBe(true);
    });

    it('refuses an inactive hotel (409) and rooms in different currencies (400)', async () => {
      const room = makeRoom();
      const inactive = build([room], {});
      inactive.hotelModel.findById.mockReturnValue(
        query({ ...hotel, isActive: false }),
      );
      await expect(
        inactive.service.createBooking(userId.toString(), dto([room])),
      ).rejects.toBeInstanceOf(ConflictException);

      const a = makeRoom({ currency: 'USD' });
      const b = makeRoom({ currency: 'EUR' });
      const mixed = build([a, b], {});
      await expect(
        mixed.service.createBooking(userId.toString(), dto([a, b])),
      ).rejects.toThrow(/same currency/);
    });
  });

  it('refuses rooms that have no price for the nights (a hold that could never be paid)', async () => {
    const room = makeRoom({ basePricePerNight: 0 });
    const ctx = build([room], {
      [room._id.toString()]: nightsRows(room, utcMidnight(10), 3),
    });

    await expect(
      ctx.service.createBooking(userId.toString(), dto([room])),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.bookingModel.create).not.toHaveBeenCalled();
  });

  it('counts the 10 minutes from when the reservation is written, not from the request start', async () => {
    const room = makeRoom();
    const ctx = build([room], {
      [room._id.toString()]: nightsRows(room, utcMidnight(10), 3),
    });
    // the write happens 30 seconds after the request started (e.g. after a transaction retry)
    const realNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(realNow + 30_000);

    const booking = await ctx.service.createBooking(
      userId.toString(),
      dto([room]),
    );
    jest.restoreAllMocks();

    expect(booking.holdExpiresAt!.getTime()).toBe(
      realNow + 30_000 + 10 * 60_000,
    );
  });

  it('tries a new reference when a random one collides', async () => {
    const room = makeRoom();
    const ctx = build([room], {
      [room._id.toString()]: nightsRows(room, utcMidnight(10), 3),
    });
    ctx.bookingModel.create.mockRejectedValueOnce({
      code: 11000,
      keyPattern: { bookingReference: 1 },
    });

    const booking = await ctx.service.createBooking(
      userId.toString(),
      dto([room]),
    );

    expect(booking.status).toBe(BookingStatus.PENDING_PAYMENT);
    expect(ctx.connection.transaction).toHaveBeenCalledTimes(2);
  });

  it('does not retry other errors', async () => {
    const room = makeRoom();
    const ctx = build([room], {
      [room._id.toString()]: nightsRows(room, utcMidnight(10), 3),
    });
    ctx.bookingModel.create.mockRejectedValue(new Error('db down'));

    await expect(
      ctx.service.createBooking(userId.toString(), dto([room])),
    ).rejects.toThrow('db down');
    expect(ctx.connection.transaction).toHaveBeenCalledTimes(1);
  });
});

describe('HotelBookingsService hold expiry (HTL-18)', () => {
  const roomA = new Types.ObjectId();
  const roomB = new Types.ObjectId();
  function heldBooking() {
    return {
      _id: new Types.ObjectId(),
      user: userId,
      bookingReference: 'HOLD1234',
      status: BookingStatus.EXPIRED,
      checkInDate: new Date('2026-12-10T00:00:00.000Z'),
      nights: 2,
      rooms: [
        { room: roomA, quantity: 1 },
        { room: roomB, quantity: 1 },
      ],
    };
  }

  it('flips the status with a conditional update and releases every room and night in the same transaction', async () => {
    const ctx = build([], {});
    const booking = heldBooking();
    ctx.bookingModel.findOneAndUpdate.mockResolvedValue(booking);
    const now = new Date();

    expect(await ctx.service.expireHold(booking._id, now)).toBe(true);

    const [filter, update, options] = ctx.bookingModel.findOneAndUpdate.mock
      .calls[0] as unknown as [
      { status: { $in: BookingStatus[] }; holdExpiresAt: { $lte: Date } },
      { $set: { status: BookingStatus } },
      { session: unknown },
    ];
    expect(filter.status.$in).toEqual([
      BookingStatus.HELD,
      BookingStatus.PENDING_PAYMENT,
    ]);
    expect(filter.holdExpiresAt.$lte).toBe(now);
    expect(update.$set.status).toBe(BookingStatus.EXPIRED);
    expect(options.session).toBe(ctx.session);

    expect(ctx.availabilityModel.updateOne).toHaveBeenCalledTimes(4); // release: 2 rooms x 2 nights
    const nights = (
      ctx.availabilityModel.updateOne.mock.calls as unknown as [
        { date: Date; heldUnits: { $gte: number } },
        { $inc: { heldUnits: number } },
      ][]
    ).map(([f, u]) => [
      f.date.toISOString().slice(0, 10),
      f.heldUnits.$gte,
      u.$inc.heldUnits,
    ]);
    expect(nights).toEqual([
      ['2026-12-10', 1, -1],
      ['2026-12-11', 1, -1],
      ['2026-12-10', 1, -1],
      ['2026-12-11', 1, -1],
    ]);
    expect(ctx.notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.BOOKING_HOLD_EXPIRED,
        recipient: userId,
      }),
    );
  });

  it('does nothing and notifies nobody when the hold was already handled', async () => {
    const ctx = build([], {});
    ctx.bookingModel.findOneAndUpdate.mockResolvedValue(null);

    expect(await ctx.service.expireHold(new Types.ObjectId(), new Date())).toBe(
      false,
    );

    expect(ctx.availabilityModel.updateOne).not.toHaveBeenCalled();
    expect(ctx.notificationsService.createNotification).not.toHaveBeenCalled();
  });

  it('keeps the release when the notification fails', async () => {
    const ctx = build([], {});
    ctx.bookingModel.findOneAndUpdate.mockResolvedValue(heldBooking());
    ctx.notificationsService.createNotification.mockRejectedValue(
      new Error('db down'),
    );

    expect(await ctx.service.expireHold(new Types.ObjectId(), new Date())).toBe(
      true,
    );
  });

  it('the job expires every stale hold, survives one failure and counts the rest', async () => {
    const ctx = build([], {});
    const a = new Types.ObjectId();
    const b = new Types.ObjectId();
    ctx.bookingModel.find.mockReturnValue(query([{ _id: a }, { _id: b }]));
    ctx.bookingModel.findOneAndUpdate
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(heldBooking());

    expect(await ctx.service.expireStaleHolds()).toBe(1);

    const [filter] = ctx.bookingModel.find.mock.calls[0] as unknown as [
      { status: { $in: BookingStatus[] }; holdExpiresAt: { $lte: Date } },
    ];
    expect(filter.status.$in).toEqual([
      BookingStatus.HELD,
      BookingStatus.PENDING_PAYMENT,
    ]);
  });
});
