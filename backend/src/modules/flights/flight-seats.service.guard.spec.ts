import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  BookingStatus,
  CabinClass,
  FlightStatus,
  PassengerType,
  TripType,
} from '../../common/enums';
import { FlightSeatsService } from './flight-seats.service';

interface Chain<T> extends PromiseLike<T> {
  lean(): Chain<T>;
  session(): Chain<T>;
  select(): Chain<T>;
}
function query<T>(result: T): Chain<T> {
  const q: Chain<T> = {
    lean: () => q,
    session: () => q,
    select: () => q,
    then: (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return q;
}

const userId = new Types.ObjectId();
const flightId = new Types.ObjectId();
const cabinId = new Types.ObjectId();

type Filter = Record<string, unknown> & {
  $or?: Array<{ status?: unknown; holdExpiresAt?: unknown }>;
};

/** A live booking plus the few filter keys the seat guard uses, evaluated like MongoDB would. */
function build() {
  const live = {
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
        departureTime: new Date(Date.now() + 5 * 86_400_000),
        arrivalTime: new Date(Date.now() + 5 * 86_400_000 + 4 * 3_600_000),
        seatNumbers: [] as string[],
      },
    ],
    passengers: [
      {
        _id: new Types.ObjectId(),
        type: PassengerType.ADULT,
        seatAssignments: [] as string[],
      },
    ],
  };
  const snapshot = structuredClone(live) as typeof live;
  // structuredClone drops ObjectId prototypes in some runtimes: rebuild the ids from the live doc
  snapshot._id = live._id;
  snapshot.user = live.user;
  snapshot.legs[0]._id = live.legs[0]._id;
  snapshot.legs[0].flight = flightId;
  snapshot.legs[0].cabin = cabinId;
  snapshot.passengers[0]._id = live.passengers[0]._id;

  const calls: string[] = [];
  const bookingModel = {
    // the seat service reads the booking once, up front
    findOne: jest.fn(() => query(snapshot)),
    updateOne: jest.fn((filter: Filter) => {
      calls.push('booking.guard');
      const leg = live.legs[0];
      const idOk =
        !('legs.0._id' in filter) ||
        (filter['legs.0._id'] as Types.ObjectId).equals(leg._id);
      const timeOk = leg.departureTime.getTime() > Date.now();
      const statusOk = live.status === BookingStatus.CONFIRMED;
      return Promise.resolve({
        matchedCount: idOk && timeOk && statusOk ? 1 : 0,
      });
    }),
  };
  const claimModel = {
    // the holder lookup runs before the transaction: this is where the other request gets in
    findOne: jest.fn(() => {
      hooks.beforeTransaction();
      return query(null);
    }),
    findOneAndUpdate: jest.fn(() => {
      calls.push('claim.upsert');
      return Promise.resolve(null);
    }),
    find: jest.fn(() => query([])),
    deleteOne: jest.fn(),
    deleteMany: jest.fn(),
  };
  const hooks = { beforeTransaction: () => undefined as void };
  const cabinModel = {
    find: jest.fn(() =>
      query([
        {
          _id: cabinId,
          flight: flightId,
          cabinClass: CabinClass.ECONOMY,
          totalSeats: 20,
        },
      ]),
    ),
  };
  const flightModel = {
    findById: jest.fn(() =>
      query({ _id: flightId, status: FlightStatus.SCHEDULED }),
    ),
    find: jest.fn(() => query([])),
  };
  const connection = {
    transaction: jest.fn(async (cb: (s: unknown) => Promise<unknown>) => {
      calls.push('tx.begin');
      const result = await cb({ id: 's' });
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
  return { service, live, snapshot, bookingModel, claimModel, hooks, calls };
}

describe('FlightSeatsService.selectSeat: seat choice racing a flight change', () => {
  it('writes the seat when the leg is still the one that was loaded', async () => {
    const t = build();
    const res = await t.service.selectSeat(
      userId.toString(),
      t.live._id.toString(),
      {
        passengerId: t.live.passengers[0]._id.toString(),
        seat: '3C',
      },
    );
    expect(res.seat).toBe('3C');
    expect(t.calls).toEqual([
      'tx.begin',
      'claim.upsert',
      'booking.guard',
      'tx.commit',
    ]);
  });

  it('puts the leg id in the guard so a replaced leg can never receive a seat', async () => {
    const t = build();
    await t.service.selectSeat(userId.toString(), t.live._id.toString(), {
      passengerId: t.live.passengers[0]._id.toString(),
      seat: '3C',
    });
    const [filter] = t.bookingModel.updateOne.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(filter['legs.0._id']).toEqual(t.live.legs[0]._id);
  });

  it('refuses and rolls back when a flight change replaced the leg between the load and the write', async () => {
    const t = build();
    // The flight change commits after selectSeat loaded the booking and before its transaction starts:
    // the booking is still CONFIRMED and the new flight departs in the future, only the leg is another one.
    t.hooks.beforeTransaction = () => {
      t.live.legs[0]._id = new Types.ObjectId();
      t.live.legs[0].flight = new Types.ObjectId();
    };
    await expect(
      t.service.selectSeat(userId.toString(), t.live._id.toString(), {
        passengerId: t.live.passengers[0]._id.toString(),
        seat: '3C',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    // the claim written inside the transaction is rolled back with it: the transaction never commits
    expect(t.calls).toContain('claim.upsert');
    expect(t.calls).not.toContain('tx.commit');
  });
});
