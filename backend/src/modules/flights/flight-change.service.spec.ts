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
  PaymentPurpose,
  PaymentStatus,
  RefundStatus,
  TripType,
} from '../../common/enums';
import { FlightChangeStatus } from './schemas/flight-change.schema';
import {
  FlightChangeService,
  paymentsNewestFirst,
} from './flight-change.service';

interface Chain<T> extends PromiseLike<T> {
  lean(): Chain<T>;
  session(): Chain<T>;
}
function query<T>(result: T): Chain<T> {
  const q: Chain<T> = {
    lean: () => q,
    session: () => q,
    then: (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return q;
}

const DAY = 86_400_000;
const userId = new Types.ObjectId();
const cai = new Types.ObjectId();
const dxb = new Types.ObjectId();
const lhr = new Types.ObjectId();
const airlineId = new Types.ObjectId();

function flight(
  num: string,
  daysAhead: number,
  overrides: Record<string, unknown> = {},
) {
  const departureTime = new Date(Date.now() + daysAhead * DAY);
  return {
    _id: new Types.ObjectId(),
    flightNumber: num,
    airline: airlineId,
    departureAirport: cai,
    arrivalAirport: dxb,
    departureTime,
    arrivalTime: new Date(departureTime.getTime() + 4 * 3_600_000),
    status: FlightStatus.SCHEDULED,
    ...overrides,
  };
}
function cabin(
  flightId: Types.ObjectId,
  basePrice: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    _id: new Types.ObjectId(),
    flight: flightId,
    cabinClass: CabinClass.ECONOMY,
    basePrice,
    currency: 'USD',
    availableSeats: 20,
    isActive: true,
    ...overrides,
  };
}
const airline = (overrides: Record<string, unknown> = {}) => ({
  _id: airlineId,
  name: 'Nile Air',
  iataCode: 'NA',
  isActive: true,
  baggagePolicy: {
    extraBagFee: 40,
    currency: 'USD',
    carryOnBagsIncluded: 1,
    carryOnMaxWeightKg: 7,
    checkedBagsIncluded: 1,
    checkedBagMaxWeightKg: 23,
    overweightFeePerKg: 15,
  },
  cancellationPolicy: {
    allowCancellation: true,
    tiers: [{ daysBeforeDeparture: 7, refundPercentage: 100 }],
    freeCancellationHoursBeforeDeparture: 24,
    cancellationFeePercentage: 20,
    fixedCancellationFee: 0,
    refundPercentageAfterCutoff: 0,
    currency: 'USD',
  },
  ...overrides,
});

interface World {
  oldFlight: ReturnType<typeof flight>;
  oldCabin: ReturnType<typeof cabin>;
  flights: ReturnType<typeof flight>[];
  cabins: ReturnType<typeof cabin>[];
  airlines: ReturnType<typeof airline>[];
  booking: ReturnType<typeof makeBooking>;
}

function makeBooking(
  oldFlight: ReturnType<typeof flight>,
  oldCabin: ReturnType<typeof cabin>,
  overrides: Record<string, unknown> = {},
) {
  return {
    _id: new Types.ObjectId(),
    user: userId,
    bookingReference: 'ABCD2345',
    status: BookingStatus.CONFIRMED,
    tripType: TripType.ONE_WAY,
    legs: [
      {
        _id: new Types.ObjectId(),
        flight: oldFlight._id,
        cabin: oldCabin._id,
        cabinClass: CabinClass.ECONOMY,
        departureTime: oldFlight.departureTime,
        arrivalTime: oldFlight.arrivalTime,
        unitPrice: 300,
        seatNumbers: [] as string[],
      },
    ],
    passengers: [
      {
        _id: new Types.ObjectId(),
        type: PassengerType.ADULT,
        extraBaggageCount: 0,
        seatAssignments: [],
      },
      {
        _id: new Types.ObjectId(),
        type: PassengerType.ADULT,
        extraBaggageCount: 0,
        seatAssignments: [],
      },
    ],
    passengerCounts: {
      adults: 2,
      children: 0,
      infants: 0,
      totalSeatsRequired: 2,
    },
    baseFareTotal: 600,
    extraBaggageTotal: 0,
    taxesAndFees: 0,
    totalPrice: 600,
    currency: 'USD',
    payment: new Types.ObjectId(),
    changeCount: 0,
    changePayments: [] as Types.ObjectId[],
    policySnapshot: {
      capturedAt: new Date(),
      legs: [
        {
          baggagePolicy: { extraBagFee: 40, currency: 'USD' },
          cancellationPolicy: { tiers: [] },
        },
      ],
    },
    ...overrides,
  };
}

function world(): World {
  const oldFlight = flight('NA100', 10);
  const oldCabin = cabin(oldFlight._id, 300);
  return {
    oldFlight,
    oldCabin,
    flights: [oldFlight],
    cabins: [oldCabin],
    airlines: [airline()],
    booking: makeBooking(oldFlight, oldCabin),
  };
}

function addFlight(
  w: World,
  num: string,
  price: number,
  daysAhead = 12,
  overrides: Record<string, unknown> = {},
  cabinOverrides: Record<string, unknown> = {},
) {
  const f = flight(num, daysAhead, overrides);
  const c = cabin(f._id, price, cabinOverrides);
  w.flights.push(f);
  w.cabins.push(c);
  return { f, c };
}

function build(
  w: World,
  options: {
    cabinUpdates?: Record<string, number>;
    pending?: Record<string, unknown> | null;
    pendingPayment?: Record<string, unknown> | null;
    claims?: Array<Record<string, unknown>>;
  } = {},
) {
  const calls: string[] = [];
  const bookingModel = {
    findOne: jest.fn(() => query(w.booking)),
    findOneAndUpdate: jest.fn(
      (_f: unknown, update: Record<string, unknown>) => {
        calls.push('booking.update');
        const set = (update.$set ?? {}) as Record<string, unknown>;
        return Promise.resolve({ toObject: () => ({ ...w.booking, ...set }) });
      },
    ),
  };
  const flightModel = {
    findById: jest.fn((id: Types.ObjectId | string) =>
      query(w.flights.find((f) => f._id.equals(id)) ?? null),
    ),
    find: jest.fn((filter: { _id: { $in: Types.ObjectId[] } }) =>
      query(
        w.flights.filter((f) => filter._id.$in.some((x) => x.equals(f._id))),
      ),
    ),
  };
  const airlineModel = {
    findById: jest.fn((id: Types.ObjectId) =>
      query(w.airlines.find((a) => a._id.equals(id)) ?? null),
    ),
  };
  const cabinModel = {
    findOne: jest.fn((filter: { flight: Types.ObjectId; cabinClass: string }) =>
      query(
        w.cabins.find(
          (c) =>
            c.flight.equals(filter.flight) &&
            (c.cabinClass as string) === filter.cabinClass &&
            c.isActive,
        ) ?? null,
      ),
    ),
    find: jest.fn((filter: { _id: { $in: Types.ObjectId[] } }) =>
      query(
        w.cabins.filter((c) => filter._id.$in.some((x) => x.equals(c._id))),
      ),
    ),
    updateOne: jest.fn(
      (
        filter: { _id: Types.ObjectId },
        update: { $inc: { availableSeats: number } },
      ) => {
        calls.push(
          `cabin.${update.$inc.availableSeats > 0 ? 'release' : 'take'}`,
        );
        const forced = options.cabinUpdates?.[filter._id.toString()];
        return Promise.resolve({ modifiedCount: forced ?? 1 });
      },
    ),
  };
  const changeModel = {
    findOne: jest.fn(() => query(options.pending ?? null)),
    create: jest.fn(
      (docs: Record<string, unknown> | Record<string, unknown>[]) => {
        calls.push('change.create');
        const list = Array.isArray(docs) ? docs : [docs];
        const made = list.map((d) => ({ _id: new Types.ObjectId(), ...d }));
        return Promise.resolve(Array.isArray(docs) ? made : made[0]);
      },
    ),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  };
  const claimModel = {
    find: jest.fn(() => query(options.claims ?? [])),
    deleteMany: jest.fn(() => {
      calls.push('claims.delete');
      return Promise.resolve({ deletedCount: 0 });
    }),
  };
  const paymentModel = {
    findById: jest.fn(() => query(options.pendingPayment ?? null)),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const connection = {
    transaction: jest.fn(async (cb: (s: unknown) => Promise<unknown>) => {
      calls.push('tx.begin');
      const r = await cb({ id: 'session' });
      calls.push('tx.commit');
      return r;
    }),
  };
  const createdPayment = {
    _id: new Types.ObjectId(),
    amount: 0,
    currency: 'USD',
    status: PaymentStatus.PENDING,
  };
  const paymentsService = {
    stripe: { id: 'stripe' },
    cancelIntent: jest.fn().mockResolvedValue(true),
    createChangePayment: jest.fn((p: { amount: number; currency: string }) =>
      Promise.resolve({
        payment: { ...createdPayment, amount: p.amount, currency: p.currency },
        intent: { id: 'pi_1', client_secret: 'pi_1_secret' },
      }),
    ),
  };
  const refundsService = {
    recordBookingRefund: jest.fn(
      (input: { amount: number; currency: string }) => {
        calls.push('refund.record');
        return Promise.resolve([
          {
            _id: new Types.ObjectId(),
            amount: input.amount,
            currency: input.currency,
            status: RefundStatus.PENDING,
          },
        ]);
      },
    ),
    dispatchRefund: jest.fn(() => {
      calls.push('refund.dispatch');
      return Promise.resolve(true);
    }),
    findRefund: jest.fn(() => Promise.resolve(null)),
  };
  const notificationsService = {
    createNotification: jest.fn().mockResolvedValue({}),
  };
  const registry = { register: jest.fn() };
  const service = new FlightChangeService(
    bookingModel as never,
    flightModel as never,
    airlineModel as never,
    cabinModel as never,
    changeModel as never,
    claimModel as never,
    paymentModel as never,
    connection as never,
    paymentsService as never,
    refundsService as never,
    notificationsService as never,
    registry as never,
  );
  return {
    service,
    bookingModel,
    flightModel,
    cabinModel,
    changeModel,
    claimModel,
    paymentModel,
    connection,
    paymentsService,
    refundsService,
    notificationsService,
    registry,
    calls,
  };
}

const owner = () => userId.toString();
const legs = (flightId: Types.ObjectId, legIndex = 0) => [
  { legIndex, flightId: flightId.toString() },
];

describe('FlightChangeService.preview', () => {
  it('quotes a higher fare as PAY_DIFFERENCE with the new airline policies', async () => {
    const w = world();
    const n = addFlight(w, 'NA200', 360);
    const t = build(w);
    const q = await t.service.preview(owner(), w.booking._id.toString(), {
      legs: legs(n.f._id),
    });
    expect(q).toMatchObject({
      currentTotal: 600,
      newTotal: 720,
      difference: 120,
      outcome: 'PAY_DIFFERENCE',
      currency: 'USD',
    });
    expect(q.legs[0]).toMatchObject({
      legIndex: 0,
      newFare: 720,
      newAirline: 'Nile Air',
      newExtraBagFee: 40,
    });
    expect(q.legs[0].from.flightNumber).toBe('NA100');
    expect(q.legs[0].to.flightNumber).toBe('NA200');
    expect(t.connection.transaction).not.toHaveBeenCalled();
    expect(t.cabinModel.updateOne).not.toHaveBeenCalled();
  });

  it('quotes a lower and an equal fare', async () => {
    const w = world();
    const cheap = addFlight(w, 'NA201', 250);
    const same = addFlight(w, 'NA202', 300);
    const t = build(w);
    expect(
      await t.service.preview(owner(), w.booking._id.toString(), {
        legs: legs(cheap.f._id),
      }),
    ).toMatchObject({ difference: -100, outcome: 'REFUND_DIFFERENCE' });
    expect(
      await t.service.preview(owner(), w.booking._id.toString(), {
        legs: legs(same.f._id),
      }),
    ).toMatchObject({ difference: 0, outcome: 'NO_DIFFERENCE' });
  });

  it('prices infants at 10% and extra bags at the new airline rate', async () => {
    const w = world();
    w.booking.passengerCounts = {
      adults: 2,
      children: 0,
      infants: 1,
      totalSeatsRequired: 2,
    };
    w.booking.baseFareTotal = 630;
    w.booking.passengers.push({
      _id: new Types.ObjectId(),
      type: PassengerType.INFANT,
      extraBaggageCount: 0,
      seatAssignments: [],
    });
    w.booking.passengers[0].extraBaggageCount = 1;
    w.booking.extraBaggageTotal = 40;
    w.booking.totalPrice = 670;
    const other = new Types.ObjectId();
    w.airlines.push(
      airline({
        _id: other,
        name: 'Gulf Air',
        baggagePolicy: { ...airline().baggagePolicy, extraBagFee: 55 },
      }),
    );
    const n = addFlight(w, 'GA1', 300, 12, { airline: other });
    const q = await build(w).service.preview(
      owner(),
      w.booking._id.toString(),
      { legs: legs(n.f._id) },
    );
    // fare unchanged (630), bag 55 instead of 40
    expect(q).toMatchObject({
      newTotal: 685,
      currentTotal: 670,
      difference: 15,
    });
  });

  it.each([
    [
      'another route',
      (w: World) => addFlight(w, 'X1', 300, 12, { arrivalAirport: lhr }),
      BadRequestException,
    ],
    [
      'the same flight',
      (w: World) => ({ f: w.oldFlight, c: w.oldCabin }),
      BadRequestException,
    ],
    [
      'a cancelled flight',
      (w: World) =>
        addFlight(w, 'X2', 300, 12, { status: FlightStatus.CANCELLED }),
      ConflictException,
    ],
    [
      'a departed flight',
      (w: World) => addFlight(w, 'X3', 300, -1),
      ConflictException,
    ],
    [
      'a flight without the booking cabin',
      (w: World) => {
        const r = addFlight(w, 'X4', 300);
        r.c.cabinClass = CabinClass.BUSINESS;
        return r;
      },
      NotFoundException,
    ],
    [
      'a cabin in another currency',
      (w: World) => addFlight(w, 'X5', 300, 12, {}, { currency: 'EUR' }),
      BadRequestException,
    ],
    [
      'a cabin with too few seats',
      (w: World) => addFlight(w, 'X6', 300, 12, {}, { availableSeats: 1 }),
      ConflictException,
    ],
    [
      'an inactive airline',
      (w: World) => {
        const o = new Types.ObjectId();
        w.airlines.push(airline({ _id: o, isActive: false }));
        return addFlight(w, 'X7', 300, 12, { airline: o });
      },
      ConflictException,
    ],
  ])('refuses %s', async (_name, make, error) => {
    const w = world();
    const n = make(w);
    await expect(
      build(w).service.preview(owner(), w.booking._id.toString(), {
        legs: legs(n.f._id),
      }),
    ).rejects.toBeInstanceOf(error);
  });

  it('refuses a booking that is not CONFIRMED, has departed, is another user’s or unknown', async () => {
    const w = world();
    const n = addFlight(w, 'NA200', 360);
    w.booking.status = BookingStatus.PENDING_PAYMENT;
    await expect(
      build(w).service.preview(owner(), w.booking._id.toString(), {
        legs: legs(n.f._id),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    w.booking.status = BookingStatus.CONFIRMED;
    w.booking.legs[0].departureTime = new Date(Date.now() - 1000);
    await expect(
      build(w).service.preview(owner(), w.booking._id.toString(), {
        legs: legs(n.f._id),
      }),
    ).rejects.toThrow(/departed/);
    w.booking.legs[0].departureTime = new Date(Date.now() + DAY);
    const t = build(w);
    t.bookingModel.findOne.mockReturnValue(query(null as never));
    await expect(
      t.service.preview(owner(), w.booking._id.toString(), {
        legs: legs(n.f._id),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      t.service.preview(owner(), 'bad', { legs: legs(n.f._id) }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const [filter] = t.bookingModel.findOne.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(filter.user).toEqual(userId);
  });

  it('refuses a missing leg and the same leg twice', async () => {
    const w = world();
    const n = addFlight(w, 'NA200', 360);
    const t = build(w);
    await expect(
      t.service.preview(owner(), w.booking._id.toString(), {
        legs: legs(n.f._id, 1),
      }),
    ).rejects.toThrow(/no leg 1/);
    await expect(
      t.service.preview(owner(), w.booking._id.toString(), {
        legs: [...legs(n.f._id), ...legs(n.f._id)],
      }),
    ).rejects.toThrow(/only be changed once/);
  });

  it('refuses a new airline whose bag limit is below the bags already booked', async () => {
    const w = world();
    w.booking.passengers[0].extraBaggageCount = 3;
    const o = new Types.ObjectId();
    w.airlines.push(
      airline({
        _id: o,
        baggagePolicy: {
          ...airline().baggagePolicy,
          maxExtraBagsPerPassenger: 1,
        },
      }),
    );
    const n = addFlight(w, 'NA200', 300, 12, { airline: o });
    await expect(
      build(w).service.preview(owner(), w.booking._id.toString(), {
        legs: legs(n.f._id),
      }),
    ).rejects.toThrow(/at most 1/);
  });

  it('on a round trip changes one leg and keeps the other, and keeps the return after the outbound', async () => {
    const w = world();
    const backF = flight('NA101', 20, {
      departureAirport: dxb,
      arrivalAirport: cai,
    });
    const backC = cabin(backF._id, 250);
    w.flights.push(backF);
    w.cabins.push(backC);
    w.booking.tripType = TripType.ROUND_TRIP;
    w.booking.legs.push({
      ...w.booking.legs[0],
      _id: new Types.ObjectId(),
      flight: backF._id,
      cabin: backC._id,
      departureTime: backF.departureTime,
      arrivalTime: backF.arrivalTime,
      unitPrice: 250,
    });
    w.booking.baseFareTotal = 1100;
    w.booking.totalPrice = 1100;
    w.booking.policySnapshot.legs.push({
      baggagePolicy: { extraBagFee: 40, currency: 'USD' },
      cancellationPolicy: { tiers: [] },
    });
    const later = addFlight(w, 'NA102', 260, 22, {
      departureAirport: dxb,
      arrivalAirport: cai,
    });
    const tooEarly = addFlight(w, 'NA103', 260, 10.05, {
      departureAirport: dxb,
      arrivalAirport: cai,
    });
    const q = await build(w).service.preview(
      owner(),
      w.booking._id.toString(),
      { legs: legs(later.f._id, 1) },
    );
    // outbound stays 600, return 2 x 260 = 520
    expect(q).toMatchObject({ newTotal: 1120, difference: 20 });
    expect(q.legs).toHaveLength(1);
    await expect(
      build(w).service.preview(owner(), w.booking._id.toString(), {
        legs: legs(tooEarly.f._id, 1),
      }),
    ).rejects.toThrow(/depart after the outbound/);
  });

  it('refuses a round trip whose leg fares cannot be told apart', async () => {
    const w = world();
    w.booking.tripType = TripType.ROUND_TRIP;
    w.booking.legs.push({
      ...w.booking.legs[0],
      _id: new Types.ObjectId(),
      unitPrice: 250,
      departureTime: new Date(Date.now() + 20 * DAY),
      arrivalTime: new Date(Date.now() + 20 * DAY + 4 * 3_600_000),
    });
    w.booking.baseFareTotal = 999;
    const n = addFlight(w, 'NA200', 360);
    await expect(
      build(w).service.preview(owner(), w.booking._id.toString(), {
        legs: legs(n.f._id),
      }),
    ).rejects.toThrow(/cannot be told apart/);
  });
});

describe('FlightChangeService.change: equal or lower fare', () => {
  it('swaps at once for an equal fare: one transaction, no refund, no payment, still CONFIRMED', async () => {
    const w = world();
    const n = addFlight(w, 'NA202', 300);
    const t = build(w);
    const res = await t.service.change(owner(), w.booking._id.toString(), {
      legs: legs(n.f._id),
      acceptPolicies: true,
    });
    expect(res).toMatchObject({
      changeStatus: 'APPLIED',
      bookingStatus: BookingStatus.CONFIRMED,
      difference: 0,
      payment: null,
      refund: null,
    });
    expect(t.calls).toEqual([
      'tx.begin',
      'cabin.take',
      'cabin.release',
      'claims.delete',
      'booking.update',
      'change.create',
      'tx.commit',
    ]);
    expect(t.refundsService.recordBookingRefund).not.toHaveBeenCalled();
    expect(t.paymentsService.createChangePayment).not.toHaveBeenCalled();
    const [filter, update] = t.bookingModel.findOneAndUpdate.mock
      .calls[0] as unknown as [
      Record<string, unknown>,
      {
        $set: Record<string, unknown>;
        $inc: Record<string, number>;
        $push?: unknown;
      },
    ];
    expect(filter.status).toBe(BookingStatus.CONFIRMED);
    expect(filter['legs.0._id']).toEqual(w.booking.legs[0]._id);
    expect(update.$inc).toEqual({ changeCount: 1 });
    expect(update.$push).toBeUndefined();
    const newLegs = update.$set.legs as Array<{
      flight: Types.ObjectId;
      seatNumbers: string[];
      fare: number;
    }>;
    expect(newLegs[0].flight).toEqual(n.f._id);
    expect(newLegs[0]).toMatchObject({ seatNumbers: [], fare: 600 });
    expect(update.$set).toMatchObject({
      baseFareTotal: 600,
      totalPrice: 600,
      extraBaggageTotal: 0,
    });
    // seats: 2 taken on the new cabin, 2 returned to the old one
    expect(t.cabinModel.updateOne).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ _id: n.c._id, availableSeats: { $gte: 2 } }),
      { $inc: { availableSeats: -2 } },
      expect.anything(),
    );
    expect(t.cabinModel.updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: w.oldCabin._id },
      { $inc: { availableSeats: 2 } },
      expect.anything(),
    );
    expect(t.notificationsService.createNotification).toHaveBeenCalledTimes(1);
  });

  it('refunds the difference through the refund engine for a lower fare, sent after the commit', async () => {
    const w = world();
    const n = addFlight(w, 'NA201', 250);
    const t = build(w);
    const res = await t.service.change(owner(), w.booking._id.toString(), {
      legs: legs(n.f._id),
      acceptPolicies: true,
      expectedDifference: -100,
    });
    expect(res).toMatchObject({
      changeStatus: 'APPLIED',
      difference: -100,
      refund: { amount: 100, currency: 'USD' },
    });
    expect(t.refundsService.recordBookingRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 100,
        currency: 'USD',
        payments: [w.booking.payment],
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        key: expect.stringMatching(/^change-/),
      }),
      expect.anything(),
    );
    expect(t.calls.indexOf('refund.record')).toBeLessThan(
      t.calls.indexOf('tx.commit'),
    );
    expect(t.calls.indexOf('refund.dispatch')).toBeGreaterThan(
      t.calls.indexOf('tx.commit'),
    );
  });

  it('keeps the total of the whole booking, refunding newest payment first', () => {
    const a = new Types.ObjectId();
    const b = new Types.ObjectId();
    const original = new Types.ObjectId();
    expect(
      paymentsNewestFirst({ payment: original, changePayments: [a, b] }),
    ).toEqual([b, a, original]);
    expect(paymentsNewestFirst({ payment: original })).toEqual([original]);
  });

  it('refuses when the price moved since the preview', async () => {
    const w = world();
    const n = addFlight(w, 'NA201', 250);
    const t = build(w);
    await expect(
      t.service.change(owner(), w.booking._id.toString(), {
        legs: legs(n.f._id),
        acceptPolicies: true,
        expectedDifference: -50,
      }),
    ).rejects.toThrow(/preview the change again/);
    expect(t.connection.transaction).not.toHaveBeenCalled();
  });

  it('aborts the whole transaction when the new flight has no seats left at the swap', async () => {
    const w = world();
    const n = addFlight(w, 'NA201', 250);
    const t = build(w, { cabinUpdates: {} });
    t.cabinModel.updateOne.mockImplementation(
      (filter: { _id: Types.ObjectId }) =>
        Promise.resolve({ modifiedCount: filter._id.equals(n.c._id) ? 0 : 1 }),
    );
    await expect(
      t.service.change(owner(), w.booking._id.toString(), {
        legs: legs(n.f._id),
        acceptPolicies: true,
      }),
    ).rejects.toThrow(/no seats left/);
    expect(t.calls).not.toContain('booking.update');
    expect(t.calls).not.toContain('tx.commit');
  });

  it('keeps the seat choices of a leg that stays and frees those of the replaced leg', async () => {
    const w = world();
    const backF = flight('NA101', 20, {
      departureAirport: dxb,
      arrivalAirport: cai,
    });
    const backC = cabin(backF._id, 250);
    w.flights.push(backF);
    w.cabins.push(backC);
    w.booking.tripType = TripType.ROUND_TRIP;
    const outId = w.booking.legs[0]._id;
    const backLeg = {
      ...w.booking.legs[0],
      _id: new Types.ObjectId(),
      flight: backF._id,
      cabin: backC._id,
      departureTime: backF.departureTime,
      arrivalTime: backF.arrivalTime,
      unitPrice: 250,
    };
    w.booking.legs.push(backLeg);
    w.booking.baseFareTotal = 1100;
    w.booking.totalPrice = 1100;
    w.booking.policySnapshot.legs.push({
      baggagePolicy: { extraBagFee: 40, currency: 'USD' },
      cancellationPolicy: { tiers: [] },
    });
    const n = addFlight(w, 'NA202', 300);
    const claim = (leg: Types.ObjectId, p: number, seat: string) => ({
      _id: new Types.ObjectId(),
      booking: w.booking._id,
      leg,
      passenger: w.booking.passengers[p]._id,
      seat,
    });
    const t = build(w, {
      claims: [
        claim(outId, 0, '3C'),
        claim(backLeg._id, 0, '4A'),
        claim(backLeg._id, 1, '4B'),
      ],
    });
    await t.service.change(owner(), w.booking._id.toString(), {
      legs: legs(n.f._id, 0),
      acceptPolicies: true,
    });
    const [, update] = t.bookingModel.findOneAndUpdate.mock
      .calls[0] as unknown as [unknown, { $set: Record<string, unknown> }];
    const newLegs = update.$set.legs as Array<{ seatNumbers: string[] }>;
    expect(newLegs[0].seatNumbers).toEqual([]);
    expect(newLegs[1].seatNumbers).toEqual(['4A', '4B']);
    expect(update.$set['passengers.0.seatAssignments']).toEqual(['4A']);
    expect(t.claimModel.deleteMany).toHaveBeenCalledWith(
      { booking: w.booking._id, leg: { $in: [outId] } },
      expect.anything(),
    );
  });
});

describe('FlightChangeService.change: higher fare', () => {
  it('creates a pending change and a PaymentIntent and leaves the booking, seats and cabins alone', async () => {
    const w = world();
    const n = addFlight(w, 'NA200', 360);
    const t = build(w);
    const res = await t.service.change(owner(), w.booking._id.toString(), {
      legs: legs(n.f._id),
      acceptPolicies: true,
    });
    expect(res).toMatchObject({
      changeStatus: 'PENDING_PAYMENT',
      bookingStatus: BookingStatus.CONFIRMED,
      difference: 120,
      refund: null,
    });
    expect(res.payment).toMatchObject({
      amount: 120,
      currency: 'USD',
      clientSecret: 'pi_1_secret',
      stripePaymentIntentId: 'pi_1',
    });
    expect(res.payment?.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 9 * 60_000,
    );
    expect(t.paymentsService.createChangePayment).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 120, currency: 'USD' }),
    );
    expect(t.bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(t.cabinModel.updateOne).not.toHaveBeenCalled();
    expect(t.connection.transaction).not.toHaveBeenCalled();
    const stored = t.changeModel.create.mock.calls[0][0] as {
      status: string;
      difference: number;
      plan: { replaced: unknown[] };
    };
    expect(stored).toMatchObject({
      status: FlightChangeStatus.PENDING_PAYMENT,
      difference: 120,
    });
    expect(stored.plan.replaced).toHaveLength(1);
  });

  it('drops the pending change when the payment provider fails', async () => {
    const w = world();
    const n = addFlight(w, 'NA200', 360);
    const t = build(w);
    t.paymentsService.createChangePayment.mockRejectedValue(
      new Error('stripe down'),
    );
    await expect(
      t.service.change(owner(), w.booking._id.toString(), {
        legs: legs(n.f._id),
        acceptPolicies: true,
      }),
    ).rejects.toThrow('stripe down');
    expect(t.changeModel.deleteOne).toHaveBeenCalled();
  });

  it('turns a duplicate pending change (race) into 409', async () => {
    const w = world();
    const n = addFlight(w, 'NA200', 360);
    const t = build(w);
    t.changeModel.create.mockRejectedValue(
      Object.assign(new Error('E11000'), { code: 11000 }),
    );
    await expect(
      t.service.change(owner(), w.booking._id.toString(), {
        legs: legs(n.f._id),
        acceptPolicies: true,
      }),
    ).rejects.toThrow(/already awaiting payment/);
  });

  it('blocks a second change while one is awaiting payment, but replaces a failed or expired one', async () => {
    const w = world();
    const n = addFlight(w, 'NA200', 360);
    const open = {
      _id: new Types.ObjectId(),
      payment: new Types.ObjectId(),
      expiresAt: new Date(Date.now() + 5 * 60_000),
    };
    await expect(
      build(w, {
        pending: open,
        pendingPayment: { status: PaymentStatus.PENDING },
      }).service.change(owner(), w.booking._id.toString(), {
        legs: legs(n.f._id),
        acceptPolicies: true,
      }),
    ).rejects.toThrow(/awaiting payment/);
    await expect(
      build(w, {
        pending: open,
        pendingPayment: { status: PaymentStatus.SUCCEEDED },
      }).service.change(owner(), w.booking._id.toString(), {
        legs: legs(n.f._id),
        acceptPolicies: true,
      }),
    ).rejects.toThrow(/being applied/);

    const failed = build(w, {
      pending: open,
      pendingPayment: {
        _id: new Types.ObjectId(),
        status: PaymentStatus.FAILED,
        stripePaymentIntentId: 'pi_old',
      },
    });
    await expect(
      failed.service.change(owner(), w.booking._id.toString(), {
        legs: legs(n.f._id),
        acceptPolicies: true,
      }),
    ).resolves.toMatchObject({ changeStatus: 'PENDING_PAYMENT' });
    expect(failed.paymentsService.cancelIntent).toHaveBeenCalledWith(
      expect.anything(),
      'pi_old',
    );
    expect(failed.changeModel.updateOne).toHaveBeenCalledWith(
      { _id: open._id, status: FlightChangeStatus.PENDING_PAYMENT },
      { $set: { status: FlightChangeStatus.SUPERSEDED } },
    );

    const expired = { ...open, expiresAt: new Date(Date.now() - 1000) };
    const old = build(w, {
      pending: expired,
      pendingPayment: {
        _id: new Types.ObjectId(),
        status: PaymentStatus.EXPIRED,
      },
    });
    await expect(
      old.service.change(owner(), w.booking._id.toString(), {
        legs: legs(n.f._id),
        acceptPolicies: true,
      }),
    ).resolves.toBeDefined();
    expect(old.changeModel.updateOne).toHaveBeenCalledWith(expect.anything(), {
      $set: { status: FlightChangeStatus.EXPIRED },
    });
  });
});

describe('FlightChangeService.settle (the payment webhook)', () => {
  async function pendingChange(
    w: World,
    n: { f: ReturnType<typeof flight>; c: ReturnType<typeof cabin> },
  ) {
    const t = build(w);
    await t.service.change(owner(), w.booking._id.toString(), {
      legs: legs(n.f._id),
      acceptPolicies: true,
    });
    const stored = t.changeModel.create.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const change = {
      _id: new Types.ObjectId(),
      ...stored,
      booking: w.booking._id,
      user: userId,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    };
    const payment = {
      _id: new Types.ObjectId(),
      user: userId,
      amount: 120,
      currency: 'USD',
      purpose: PaymentPurpose.FLIGHT_CHANGE,
      flightChange: change._id,
      changedFlightBooking: w.booking._id,
    };
    return { change, payment };
  }

  it('applies the paid change in the same transaction and keeps the payment on the booking', async () => {
    const w = world();
    const n = addFlight(w, 'NA200', 360);
    const { change, payment } = await pendingChange(w, n);
    const t = build(w);
    t.changeModel.findOne.mockReturnValue(query(change as never));
    const out = await t.service.settle(payment as never, new Date(), {
      id: 's',
    } as never);
    expect(out.kind).toBe('applied');
    const [, update] = t.bookingModel.findOneAndUpdate.mock
      .calls[0] as unknown as [
      unknown,
      {
        $set: Record<string, unknown>;
        $push: { changePayments: Types.ObjectId };
      },
    ];
    expect(update.$push.changePayments).toEqual(payment._id);
    expect(update.$set.totalPrice).toBe(720);
    expect(t.changeModel.updateOne).toHaveBeenCalledWith(
      { _id: change._id },
      {
        $set: expect.objectContaining({
          status: FlightChangeStatus.APPLIED,
        }) as unknown,
      },
      expect.anything(),
    );
    await out.afterCommit();
    expect(t.notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Flight changed' }),
    );
  });

  it('asks for a full refund and writes nothing to the booking when the new flight has no seats left', async () => {
    const w = world();
    const n = addFlight(w, 'NA200', 360);
    const { change, payment } = await pendingChange(w, n);
    const t = build(w);
    t.changeModel.findOne.mockReturnValue(query(change as never));
    t.cabinModel.updateOne.mockResolvedValue({ modifiedCount: 0 });
    const out = await t.service.settle(payment as never, new Date(), {
      id: 's',
    } as never);
    expect(out.kind).toBe('refund');
    expect(t.bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(t.claimModel.deleteMany).not.toHaveBeenCalled();
    expect(t.changeModel.updateOne).toHaveBeenCalledWith(
      { _id: change._id },
      {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        $set: expect.objectContaining({
          status: FlightChangeStatus.FAILED,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          failureReason: expect.stringContaining('no seats left'),
        }),
      },
      expect.anything(),
    );
    await out.afterCommit();
    expect(t.notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        message: expect.stringContaining('refunded in full'),
      }),
    );
  });

  it('puts back the seats it took on one leg when a later leg has none (round trip)', async () => {
    const w = world();
    const backF = flight('NA101', 20, {
      departureAirport: dxb,
      arrivalAirport: cai,
    });
    const backC = cabin(backF._id, 250);
    w.flights.push(backF);
    w.cabins.push(backC);
    w.booking.tripType = TripType.ROUND_TRIP;
    w.booking.legs.push({
      ...w.booking.legs[0],
      _id: new Types.ObjectId(),
      flight: backF._id,
      cabin: backC._id,
      departureTime: backF.departureTime,
      arrivalTime: backF.arrivalTime,
      unitPrice: 250,
    });
    w.booking.baseFareTotal = 1100;
    w.booking.totalPrice = 1100;
    w.booking.policySnapshot.legs.push({
      baggagePolicy: { extraBagFee: 40, currency: 'USD' },
      cancellationPolicy: { tiers: [] },
    });
    const out1 = addFlight(w, 'NA210', 400);
    const back1 = addFlight(w, 'NA211', 300, 24, {
      departureAirport: dxb,
      arrivalAirport: cai,
    });
    const t0 = build(w);
    await t0.service.change(owner(), w.booking._id.toString(), {
      legs: [...legs(out1.f._id, 0), ...legs(back1.f._id, 1)],
      acceptPolicies: true,
    });
    const stored = t0.changeModel.create.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const change = {
      _id: new Types.ObjectId(),
      ...stored,
      booking: w.booking._id,
      user: userId,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const payment = {
      _id: new Types.ObjectId(),
      user: userId,
      amount: 300,
      currency: 'USD',
      flightChange: change._id,
      changedFlightBooking: w.booking._id,
    };
    const t = build(w, { cabinUpdates: { [back1.c._id.toString()]: 0 } });
    t.changeModel.findOne.mockReturnValue(query(change as never));
    const out = await t.service.settle(payment as never, new Date(), {
      id: 's',
    } as never);
    expect(out.kind).toBe('refund');
    // took 2 on the first new cabin, then gave them back
    expect(t.cabinModel.updateOne).toHaveBeenCalledWith(
      { _id: out1.c._id },
      { $inc: { availableSeats: 2 } },
      expect.anything(),
    );
  });

  it('refunds a payment that arrives after the offer ended, or for a change that is no longer open', async () => {
    const w = world();
    const n = addFlight(w, 'NA200', 360);
    const { change, payment } = await pendingChange(w, n);
    const late = build(w);
    late.changeModel.findOne.mockReturnValue(
      query({ ...change, expiresAt: new Date(Date.now() - 60_000) } as never),
    );
    expect(
      (await late.service.settle(payment as never, new Date(), {} as never))
        .kind,
    ).toBe('refund');
    expect(late.bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
    const gone = build(w);
    gone.changeModel.findOne.mockReturnValue(query(null as never));
    expect(
      (await gone.service.settle(payment as never, new Date(), {} as never))
        .kind,
    ).toBe('refund');
  });

  it('refunds when the booking was cancelled or changed meanwhile', async () => {
    const w = world();
    const n = addFlight(w, 'NA200', 360);
    const { change, payment } = await pendingChange(w, n);
    const t = build(w);
    t.changeModel.findOne.mockReturnValue(query(change as never));
    t.bookingModel.findOne.mockReturnValue(query(null as never));
    expect(
      (await t.service.settle(payment as never, new Date(), {} as never)).kind,
    ).toBe('refund');
    const t2 = build(w);
    t2.changeModel.findOne.mockReturnValue(query(change as never));
    w.booking.legs[0]._id = new Types.ObjectId();
    expect(
      (await t2.service.settle(payment as never, new Date(), {} as never)).kind,
    ).toBe('refund');
    expect(t2.cabinModel.updateOne).not.toHaveBeenCalled();
  });

  it('registers itself for FLIGHT_CHANGE payments', () => {
    const t = build(world());
    t.service.onModuleInit();
    expect(t.registry.register).toHaveBeenCalledWith(
      PaymentPurpose.FLIGHT_CHANGE,
      t.service,
    );
  });
});
