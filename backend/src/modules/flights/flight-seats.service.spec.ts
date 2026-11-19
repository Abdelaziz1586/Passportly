import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import {
  BookingStatus,
  CabinClass,
  FlightStatus,
  PassengerType,
  TripType,
} from '../../common/enums';
import {
  FlightSeatsService,
  isBookingHoldingSeats,
} from './flight-seats.service';

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

const DAY = 86_400_000;
const userId = new Types.ObjectId();
const flightId = new Types.ObjectId();
const cabinId = new Types.ObjectId();

function makeBooking(overrides: Record<string, unknown> = {}) {
  const departure = new Date(Date.now() + 5 * DAY);
  return {
    _id: new Types.ObjectId(),
    user: userId,
    bookingReference: 'ABCD2345',
    status: BookingStatus.CONFIRMED,
    tripType: TripType.ONE_WAY,
    legs: [
      {
        _id: new Types.ObjectId(),
        flight: flightId,
        cabin: cabinId,
        cabinClass: CabinClass.ECONOMY,
        departureTime: departure,
        arrivalTime: new Date(departure.getTime() + 4 * 3_600_000),
        seatNumbers: [] as string[],
      },
    ],
    passengers: [
      {
        _id: new Types.ObjectId(),
        type: PassengerType.ADULT,
        seatAssignments: [],
      },
      {
        _id: new Types.ObjectId(),
        type: PassengerType.ADULT,
        seatAssignments: [],
      },
      {
        _id: new Types.ObjectId(),
        type: PassengerType.INFANT,
        seatAssignments: [],
      },
    ],
    ...overrides,
  };
}

type Booking = ReturnType<typeof makeBooking>;

interface Options {
  booking?: Booking | null;
  holder?: Record<string, unknown> | null;
  holderBooking?: Record<string, unknown> | null;
  flight?: Record<string, unknown> | null;
  claimsAfter?: Array<Record<string, unknown>>;
  before?: { seat: string } | null;
  guardMatched?: number;
  upsertError?: Error;
  cabins?: Array<Record<string, unknown>>;
}

function build(options: Options = {}) {
  const booking =
    options.booking === undefined ? makeBooking() : options.booking;
  const calls: string[] = [];
  const bookingModel = {
    findOne: jest.fn(() => query(booking)),
    findById: jest.fn(() => query(options.holderBooking ?? null)),
    find: jest.fn(() => query([] as unknown[])),
    updateOne: jest.fn(() => {
      calls.push('booking.guard');
      return Promise.resolve({ matchedCount: options.guardMatched ?? 1 });
    }),
  };
  const claimModel = {
    findOne: jest.fn(() => query(options.holder ?? null)),
    findOneAndUpdate: jest.fn(() => {
      calls.push('claim.upsert');
      return options.upsertError
        ? Promise.reject(options.upsertError)
        : Promise.resolve(options.before ?? null);
    }),
    find: jest.fn(() => query(options.claimsAfter ?? [])),
    deleteOne: jest.fn(() => {
      calls.push('claim.deleteOne');
      return Promise.resolve({ deletedCount: 1 });
    }),
    deleteMany: jest.fn(() => Promise.resolve({ deletedCount: 0 })),
  };
  const cabinModel = {
    find: jest.fn(() =>
      query(
        options.cabins ?? [
          {
            _id: cabinId,
            flight: flightId,
            cabinClass: CabinClass.FIRST,
            totalSeats: 6,
          },
          {
            _id: cabinId,
            flight: flightId,
            cabinClass: CabinClass.ECONOMY,
            totalSeats: 20,
          },
        ],
      ),
    ),
  };
  const flightModel = {
    find: jest.fn(() =>
      query([
        {
          _id: flightId,
          flightNumber: 'XY100',
          status: FlightStatus.SCHEDULED,
        },
      ]),
    ),
    findById: jest.fn(() =>
      query(
        options.flight === undefined
          ? { _id: flightId, status: FlightStatus.SCHEDULED }
          : options.flight,
      ),
    ),
  };
  const connection = {
    transaction: jest.fn(async (cb: (s: unknown) => Promise<unknown>) => {
      calls.push('tx.begin');
      const result = await cb({ id: 'session' });
      calls.push('tx.commit');
      return result;
    }),
  };
  const service = new FlightSeatsService(
    bookingModel as never,
    claimModel as never,
    cabinModel as never,
    flightModel as never,
    connection as never,
  );
  return {
    service,
    booking,
    bookingModel,
    claimModel,
    cabinModel,
    flightModel,
    connection,
    calls,
  };
}

function claimFor(booking: Booking, passengerIndex: number, seat: string) {
  return {
    _id: new Types.ObjectId(),
    flight: flightId,
    cabin: cabinId,
    booking: booking._id,
    leg: booking.legs[0]._id,
    passenger: booking.passengers[passengerIndex]._id,
    seat,
  };
}

describe('FlightSeatsService.selectSeat', () => {
  // Cabins: FIRST has 6 seats (row 1), ECONOMY has 20 seats (rows 2-5, row 5 short: A-B)
  it('assigns a seat inside one transaction and mirrors it on the booking', async () => {
    const t = build();
    const booking = t.booking!;
    t.claimModel.find.mockReturnValue(query([claimFor(booking, 0, '3C')]));
    const res = await t.service.selectSeat(
      userId.toString(),
      booking._id.toString(),
      {
        passengerId: booking.passengers[0]._id.toString(),
        seat: '3C',
      },
    );

    expect(res).toMatchObject({ seat: '3C', previousSeat: null, legIndex: 0 });
    expect(t.calls).toEqual([
      'tx.begin',
      'claim.upsert',
      'booking.guard',
      'tx.commit',
    ]);
    const [filter, update] = t.bookingModel.updateOne.mock
      .calls[0] as unknown as [
      Record<string, unknown>,
      { $set: Record<string, string[]> },
    ];
    expect(filter.user).toBe(userId);
    expect(update.$set['legs.0.seatNumbers']).toEqual(['3C']);
    expect(update.$set['passengers.0.seatAssignments']).toEqual(['3C']);
    expect(update.$set['passengers.1.seatAssignments']).toEqual([]);
    // the claim filter identifies booking + leg + passenger
    const [claimFilter] = t.claimModel.findOneAndUpdate.mock
      .calls[0] as unknown as [Record<string, unknown>];
    expect(claimFilter).toEqual({
      booking: booking._id,
      leg: booking.legs[0]._id,
      passenger: booking.passengers[0]._id,
    });
  });

  it('reports the previous seat when it is changed', async () => {
    const t = build({ before: { seat: '2A' } });
    const booking = t.booking!;
    t.claimModel.find.mockReturnValue(query([claimFor(booking, 0, '3C')]));
    const res = await t.service.selectSeat(
      userId.toString(),
      booking._id.toString(),
      {
        passengerId: booking.passengers[0]._id.toString(),
        seat: '3C',
      },
    );
    expect(res.previousSeat).toBe('2A');
  });

  it('is a no-op when the passenger already has that seat', async () => {
    const booking = makeBooking();
    const t = build({ booking, holder: claimFor(booking, 0, '3C') });
    const res = await t.service.selectSeat(
      userId.toString(),
      booking._id.toString(),
      {
        passengerId: booking.passengers[0]._id.toString(),
        seat: '3C',
      },
    );
    expect(res.seat).toBe('3C');
    expect(t.connection.transaction).not.toHaveBeenCalled();
  });

  it('works on a live hold that already has passengers', async () => {
    const booking = makeBooking({
      status: BookingStatus.PENDING_PAYMENT,
      holdExpiresAt: new Date(Date.now() + 60_000),
    });
    const t = build({ booking });
    t.claimModel.find.mockReturnValue(query([]));
    await expect(
      t.service.selectSeat(userId.toString(), booking._id.toString(), {
        passengerId: booking.passengers[1]._id.toString(),
        seat: '2A',
        legIndex: 0,
      }),
    ).resolves.toMatchObject({ seat: '2A' });
  });

  it('refuses a seat held by another active booking with 409 and never opens a transaction', async () => {
    const other = makeBooking();
    const t = build({
      holder: { ...claimFor(other, 0, '3C') },
      holderBooking: { status: BookingStatus.CONFIRMED },
    });
    const booking = t.booking!;
    await expect(
      t.service.selectSeat(userId.toString(), booking._id.toString(), {
        passengerId: booking.passengers[0]._id.toString(),
        seat: '3C',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(t.connection.transaction).not.toHaveBeenCalled();
    expect(t.claimModel.deleteOne).not.toHaveBeenCalled();
  });

  it.each([
    ['cancelled', { status: BookingStatus.CANCELLED }],
    ['expired', { status: BookingStatus.EXPIRED }],
    [
      'a lapsed hold',
      {
        status: BookingStatus.PENDING_PAYMENT,
        holdExpiresAt: new Date(Date.now() - 1000),
      },
    ],
    ['missing', null],
  ])(
    'frees a seat whose holder is %s and then assigns it',
    async (_name, holderBooking) => {
      const other = makeBooking();
      const t = build({ holder: claimFor(other, 0, '3C'), holderBooking });
      const booking = t.booking!;
      t.claimModel.find.mockReturnValue(query([claimFor(booking, 0, '3C')]));
      const res = await t.service.selectSeat(
        userId.toString(),
        booking._id.toString(),
        {
          passengerId: booking.passengers[0]._id.toString(),
          seat: '3C',
        },
      );
      expect(res.seat).toBe('3C');
      expect(t.calls).toEqual([
        'claim.deleteOne',
        'tx.begin',
        'claim.upsert',
        'booking.guard',
        'tx.commit',
      ]);
    },
  );

  it('turns a duplicate key on the seat index (lost race) into 409', async () => {
    const t = build({
      upsertError: Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
        keyPattern: { flight: 1, seat: 1 },
      }),
    });
    const booking = t.booking!;
    await expect(
      t.service.selectSeat(userId.toString(), booking._id.toString(), {
        passengerId: booking.passengers[0]._id.toString(),
        seat: '3C',
      }),
    ).rejects.toThrow(/just taken/);
  });

  it('turns a duplicate key on the passenger index into a retry-409', async () => {
    const t = build({
      upsertError: Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
        keyPattern: { booking: 1, leg: 1, passenger: 1 },
      }),
    });
    const booking = t.booking!;
    await expect(
      t.service.selectSeat(userId.toString(), booking._id.toString(), {
        passengerId: booking.passengers[0]._id.toString(),
        seat: '3C',
      }),
    ).rejects.toThrow(/same time/);
  });

  it('passes other database errors through', async () => {
    const t = build({ upsertError: new Error('boom') });
    const booking = t.booking!;
    await expect(
      t.service.selectSeat(userId.toString(), booking._id.toString(), {
        passengerId: booking.passengers[0]._id.toString(),
        seat: '3C',
      }),
    ).rejects.toThrow('boom');
  });

  it('rolls back (409) when the booking stopped being active while the seat was written', async () => {
    const t = build({ guardMatched: 0 });
    const booking = t.booking!;
    await expect(
      t.service.selectSeat(userId.toString(), booking._id.toString(), {
        passengerId: booking.passengers[0]._id.toString(),
        seat: '3C',
      }),
    ).rejects.toThrow(/no longer receive seat changes/);
    expect(t.calls).not.toContain('tx.commit');
  });

  it('is 404 for another user, a bad id or a missing booking', async () => {
    const t = build({ booking: null });
    await expect(
      t.service.selectSeat(userId.toString(), new Types.ObjectId().toString(), {
        passengerId: new Types.ObjectId().toString(),
        seat: '3C',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      t.service.selectSeat(userId.toString(), 'not-an-id', {
        passengerId: new Types.ObjectId().toString(),
        seat: '3C',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // ownership is part of the query, taken from the JWT user id
    const [filter] = t.bookingModel.findOne.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(filter.user).toEqual(userId);
  });

  it.each([
    [BookingStatus.CANCELLED],
    [BookingStatus.EXPIRED],
    [BookingStatus.COMPLETED],
  ])('refuses a %s booking with 409', async (status) => {
    const t = build({ booking: makeBooking({ status }) });
    await expect(
      t.service.selectSeat(userId.toString(), t.booking!._id.toString(), {
        passengerId: t.booking!.passengers[0]._id.toString(),
        seat: '3C',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a hold that has run out', async () => {
    const booking = makeBooking({
      status: BookingStatus.PENDING_PAYMENT,
      holdExpiresAt: new Date(Date.now() - 1),
    });
    const t = build({ booking });
    await expect(
      t.service.selectSeat(userId.toString(), booking._id.toString(), {
        passengerId: booking.passengers[0]._id.toString(),
        seat: '3C',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a booking without passenger details', async () => {
    const booking = makeBooking({
      status: BookingStatus.PENDING_PAYMENT,
      holdExpiresAt: new Date(Date.now() + 60_000),
      passengers: [],
    });
    const t = build({ booking });
    await expect(
      t.service.selectSeat(userId.toString(), booking._id.toString(), {
        passengerId: new Types.ObjectId().toString(),
        seat: '3C',
      }),
    ).rejects.toThrow(/passenger details first/);
  });

  it('refuses a leg that has departed', async () => {
    const booking = makeBooking();
    booking.legs[0].departureTime = new Date(Date.now() - 1000);
    const t = build({ booking });
    await expect(
      t.service.selectSeat(userId.toString(), booking._id.toString(), {
        passengerId: booking.passengers[0]._id.toString(),
        seat: '3C',
      }),
    ).rejects.toThrow(/already departed/);
  });

  it('refuses a missing leg, an unknown passenger and an infant', async () => {
    const t = build();
    const booking = t.booking!;
    const id = booking._id.toString();
    await expect(
      t.service.selectSeat(userId.toString(), id, {
        passengerId: booking.passengers[0]._id.toString(),
        seat: '3C',
        legIndex: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      t.service.selectSeat(userId.toString(), id, {
        passengerId: new Types.ObjectId().toString(),
        seat: '3C',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      t.service.selectSeat(userId.toString(), id, {
        passengerId: booking.passengers[2]._id.toString(),
        seat: '3C',
      }),
    ).rejects.toThrow(/infant/i);
  });

  it('refuses seats outside the passenger cabin or past the short last row', async () => {
    const t = build();
    const booking = t.booking!;
    const base = {
      passengerId: booking.passengers[0]._id.toString(),
    };
    // 1A is in FIRST, the passenger flies ECONOMY (rows 2-5)
    for (const seat of ['1A', '6A', '5C', '5F']) {
      await expect(
        t.service.selectSeat(userId.toString(), booking._id.toString(), {
          ...base,
          seat,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(t.connection.transaction).not.toHaveBeenCalled();
  });

  it('refuses a cancelled flight', async () => {
    const t = build({ flight: { status: FlightStatus.CANCELLED } });
    await expect(
      t.service.selectSeat(userId.toString(), t.booking!._id.toString(), {
        passengerId: t.booking!.passengers[0]._id.toString(),
        seat: '3C',
      }),
    ).rejects.toThrow(/cancelled/);
  });

  it('orders seats per leg by passenger and per passenger by leg on a round trip', async () => {
    const booking = makeBooking({ tripType: TripType.ROUND_TRIP });
    booking.legs.push({
      ...booking.legs[0],
      _id: new Types.ObjectId(),
      seatNumbers: [],
    });
    const t = build({ booking });
    t.claimModel.find.mockReturnValue(
      query([
        { ...claimFor(booking, 1, '2B') },
        { ...claimFor(booking, 0, '2A') },
        { ...claimFor(booking, 0, '4D'), leg: booking.legs[1]._id },
      ]),
    );
    await t.service.selectSeat(userId.toString(), booking._id.toString(), {
      passengerId: booking.passengers[1]._id.toString(),
      seat: '2B',
    });
    const [, update] = t.bookingModel.updateOne.mock.calls[0] as unknown as [
      unknown,
      { $set: Record<string, string[]> },
    ];
    expect(update.$set['legs.0.seatNumbers']).toEqual(['2A', '2B']);
    expect(update.$set['legs.1.seatNumbers']).toEqual(['4D']);
    expect(update.$set['passengers.0.seatAssignments']).toEqual(['2A', '4D']);
    expect(update.$set['passengers.1.seatAssignments']).toEqual(['2B']);
  });
});

describe('isBookingHoldingSeats', () => {
  const now = new Date();
  it.each([
    [BookingStatus.CONFIRMED, undefined, true],
    [BookingStatus.PENDING_PAYMENT, new Date(now.getTime() + 1000), true],
    [BookingStatus.HELD, new Date(now.getTime() + 1000), true],
    [BookingStatus.PENDING_PAYMENT, new Date(now.getTime() - 1000), false],
    [BookingStatus.PENDING_PAYMENT, undefined, false],
    [BookingStatus.CANCELLED, undefined, false],
    [BookingStatus.EXPIRED, undefined, false],
    [BookingStatus.COMPLETED, undefined, false],
  ])('%s with hold %s -> %s', (status, holdExpiresAt, expected) => {
    expect(isBookingHoldingSeats({ status, holdExpiresAt }, now)).toBe(
      expected,
    );
  });
});

describe('FlightSeatsService.getSeatMap', () => {
  it('lists taken seats of active bookings only and this booking’s own seats', async () => {
    const booking = makeBooking();
    const other = makeBooking();
    const dead = makeBooking();
    const t = build({ booking });
    t.claimModel.find.mockReturnValue(
      query([
        claimFor(booking, 0, '3C'),
        claimFor(other, 0, '2A'),
        claimFor(dead, 0, '2B'),
        { ...claimFor(other, 1, '1A') }, // FIRST cabin seat: not part of this cabin
      ]),
    );
    t.bookingModel.find.mockReturnValue(
      query([
        { _id: booking._id, status: BookingStatus.CONFIRMED },
        { _id: other._id, status: BookingStatus.CONFIRMED },
        { _id: dead._id, status: BookingStatus.CANCELLED },
      ]),
    );
    const map = await t.service.getSeatMap(
      userId.toString(),
      booking._id.toString(),
    );
    expect(map.legs).toHaveLength(1);
    expect(map.legs[0]).toMatchObject({
      flightNumber: 'XY100',
      cabinClass: CabinClass.ECONOMY,
      firstRow: 2,
      lastRow: 5,
      totalSeats: 20,
      takenSeats: ['2A', '3C'],
      selectable: true,
    });
    expect(map.legs[0].yourSeats).toEqual([
      { passengerId: booking.passengers[0]._id.toString(), seat: '3C' },
    ]);
  });

  it('is 404 for someone else’s booking', async () => {
    const t = build({ booking: null });
    await expect(
      t.service.getSeatMap(userId.toString(), new Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('FlightSeatsService.releaseStaleClaims', () => {
  it('deletes the claims of bookings that are not active any more', async () => {
    const live = makeBooking();
    const dead = makeBooking();
    const t = build();
    const liveClaim = claimFor(live, 0, '2A');
    const deadClaim = claimFor(dead, 0, '2B');
    t.claimModel.find.mockReturnValue(query([liveClaim, deadClaim]));
    t.bookingModel.find.mockReturnValue(
      query([
        { _id: live._id, status: BookingStatus.CONFIRMED },
        { _id: dead._id, status: BookingStatus.EXPIRED },
      ]),
    );
    await expect(t.service.releaseStaleClaims()).resolves.toBe(1);
    expect(t.claimModel.deleteMany).toHaveBeenCalledWith({
      _id: { $in: [deadClaim._id] },
    });
  });

  it('does nothing when every claim is active, and survives errors', async () => {
    const t = build();
    t.claimModel.find.mockReturnValue(query([]));
    await expect(t.service.releaseStaleClaims()).resolves.toBe(0);
    t.claimModel.find.mockImplementation(() => {
      throw new Error('db down');
    });
    await expect(t.service.releaseStaleClaims()).resolves.toBe(0);
  });
});
