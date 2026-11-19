import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import {
  BookingStatus,
  CabinClass,
  FlightStatus,
  PassengerType,
  TripType,
} from '../../common/enums';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateFlightBookingDto,
  PassengerDetailsDto,
  PassengerGender,
} from './dto/create-flight-booking.dto';
import { FlightBookingsService } from './flight-bookings.service';
import { Airline } from './schemas/airline.schema';
import { CabinInventory } from './schemas/cabin-inventory.schema';
import { FlightBooking } from './schemas/flight-booking.schema';
import { Flight } from './schemas/flight.schema';

const HOUR = 3_600_000;
const MINUTE = 60_000;

interface StoredBooking {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  bookingReference: string;
  status: BookingStatus;
  tripType: TripType;
  holdExpiresAt: Date;
  legs: {
    flight: Types.ObjectId;
    cabin: Types.ObjectId;
    cabinClass: CabinClass;
    departureTime: Date;
    arrivalTime: Date;
    unitPrice: number;
  }[];
  passengers: Record<string, unknown>[];
  passengerCounts: {
    adults: number;
    children: number;
    infants: number;
    totalSeatsRequired: number;
  };
  baseFareTotal: number;
  extraBaggageTotal: number;
  taxesAndFees: number;
  totalPrice: number;
  currency: string;
  policySnapshot?: unknown;
}

interface UpdateArgs {
  filter: {
    _id: Types.ObjectId;
    user: Types.ObjectId;
    status: BookingStatus;
    holdExpiresAt: { $gt: Date };
    'passengers.0': { $exists: boolean };
  };
  update: { $set: Record<string, unknown> };
}

const userId = new Types.ObjectId();

function makeAirline(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    name: 'Nile Air',
    isActive: true,
    baggagePolicy: {
      carryOnBagsIncluded: 1,
      carryOnMaxWeightKg: 7,
      carryOnMaxDimensions: '55x40x20',
      checkedBagsIncluded: 1,
      checkedBagMaxWeightKg: 23,
      extraBagFee: 40,
      maxExtraBagsPerPassenger: undefined as number | undefined,
      overweightFeePerKg: 15,
      currency: 'USD',
      notes: undefined,
    },
    cancellationPolicy: {
      allowCancellation: true,
      freeCancellationHoursBeforeDeparture: 24,
      cancellationFeePercentage: 20,
      fixedCancellationFee: 5,
      refundPercentageAfterCutoff: 10,
      currency: 'USD',
      termsText: 'Be kind to the airline',
    },
    ...overrides,
  };
}

function makeFlight(airlineId: Types.ObjectId, hoursAhead = 48) {
  return {
    _id: new Types.ObjectId(),
    airline: airlineId,
    flightNumber: 'NA100',
    status: FlightStatus.SCHEDULED,
    departureTime: new Date(Date.now() + hoursAhead * HOUR),
  };
}

function makeCabin(flightId: Types.ObjectId, overrides = {}) {
  return {
    _id: new Types.ObjectId(),
    flight: flightId,
    cabinClass: CabinClass.ECONOMY,
    currency: 'USD',
    ...overrides,
  };
}

function adult(overrides: Partial<PassengerDetailsDto> = {}) {
  return {
    firstName: 'Layla',
    lastName: 'Hassan',
    type: PassengerType.ADULT,
    dateOfBirth: '1990-05-17',
    gender: PassengerGender.FEMALE,
    passportNumber: 'A1234567',
    passportExpiry: '2099-01-31',
    nationality: 'eg',
    extraBaggageCount: 0,
    ...overrides,
  };
}

describe('FlightBookingsService.createBooking', () => {
  let service: FlightBookingsService;
  let store: StoredBooking | null;
  let airlines: ReturnType<typeof makeAirline>[];
  let flights: ReturnType<typeof makeFlight>[];
  let cabins: ReturnType<typeof makeCabin>[];

  const bookingModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
  };
  const airlineModel = { find: jest.fn() };
  const flightModel = { find: jest.fn() };
  const cabinModel = { find: jest.fn() };

  /** One-way booking on the first flight/cabin. */
  function seedOneWay(overrides: Partial<StoredBooking> = {}) {
    const flight = flights[0];
    const cabin = cabins[0];
    store = {
      _id: new Types.ObjectId(),
      user: userId,
      bookingReference: 'ABCD2345',
      status: BookingStatus.PENDING_PAYMENT,
      tripType: TripType.ONE_WAY,
      holdExpiresAt: new Date(Date.now() + 10 * MINUTE),
      legs: [
        {
          flight: flight._id,
          cabin: cabin._id,
          cabinClass: CabinClass.ECONOMY,
          departureTime: flight.departureTime,
          arrivalTime: new Date(flight.departureTime.getTime() + 4 * HOUR),
          unitPrice: 100,
        },
      ],
      passengers: [],
      passengerCounts: {
        adults: 2,
        children: 0,
        infants: 0,
        totalSeatsRequired: 2,
      },
      baseFareTotal: 200,
      extraBaggageTotal: 0,
      taxesAndFees: 0,
      totalPrice: 200,
      currency: 'USD',
      ...overrides,
    };
    return store;
  }

  function dtoFor(passengers: PassengerDetailsDto[]): CreateFlightBookingDto {
    return { bookingId: store!._id.toString(), passengers };
  }

  const twoAdults = (bags: [number, number] = [0, 0]) => [
    adult({ extraBaggageCount: bags[0] }),
    adult({
      firstName: 'Omar',
      passportNumber: 'B7654321',
      gender: PassengerGender.MALE,
      extraBaggageCount: bags[1],
    }),
  ];

  function lastUpdate(): UpdateArgs {
    const [filter, update] = bookingModel.findOneAndUpdate.mock.calls[0] as [
      UpdateArgs['filter'],
      UpdateArgs['update'],
    ];
    return { filter, update };
  }

  /** Birth date that makes someone `years` old on the outbound departure date (+offsetDays moves the birthday later). */
  function dobFor(years: number, offsetDays = 0): string {
    const departure = store!.legs[0].departureTime;
    return new Date(
      Date.UTC(
        departure.getUTCFullYear() - years,
        departure.getUTCMonth(),
        departure.getUTCDate() + offsetDays,
      ),
    )
      .toISOString()
      .slice(0, 10);
  }

  function seedCounts(adults: number, children: number, infants: number) {
    seedOneWay({
      passengerCounts: {
        adults,
        children,
        infants,
        totalSeatsRequired: adults + children,
      },
    });
  }

  /** Turns the stored booking into a round trip with a second airline on the way back. */
  function addReturnLeg() {
    const returnAirline = makeAirline({ name: 'Delta Jet' });
    const returnFlight = makeFlight(returnAirline._id, 120);
    airlines.push(returnAirline);
    flights.push(returnFlight);
    cabins.push(makeCabin(returnFlight._id));
    seedOneWay({
      tripType: TripType.ROUND_TRIP,
      baseFareTotal: 400,
      totalPrice: 400,
    });
    store!.legs.push({
      flight: returnFlight._id,
      cabin: cabins[1]._id,
      cabinClass: CabinClass.ECONOMY,
      departureTime: returnFlight.departureTime,
      arrivalTime: new Date(returnFlight.departureTime.getTime() + 4 * HOUR),
      unitPrice: 100,
    });
    return returnAirline;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    const airline = makeAirline();
    airlines = [airline];
    const flight = makeFlight(airline._id);
    flights = [flight];
    cabins = [makeCabin(flight._id)];
    seedOneWay();

    bookingModel.findOne.mockImplementation(
      (filter: { _id: Types.ObjectId; user: Types.ObjectId }) =>
        Promise.resolve(
          store &&
            store._id.equals(filter._id) &&
            store.user.equals(filter.user)
            ? { ...store }
            : null,
        ),
    );
    // Same conditional semantics as MongoDB: only one submit can win.
    bookingModel.findOneAndUpdate.mockImplementation(
      (filter: UpdateArgs['filter'], update: UpdateArgs['update']) => {
        if (
          !store ||
          !store._id.equals(filter._id) ||
          !store.user.equals(filter.user) ||
          store.status !== filter.status ||
          store.passengers.length > 0 ||
          !(store.holdExpiresAt.getTime() > filter.holdExpiresAt.$gt.getTime())
        ) {
          return Promise.resolve(null);
        }
        store = { ...store, ...update.$set };
        return Promise.resolve({ ...store });
      },
    );
    flightModel.find.mockImplementation(() => Promise.resolve(flights));
    airlineModel.find.mockImplementation(() => Promise.resolve(airlines));
    cabinModel.find.mockImplementation(() => Promise.resolve(cabins));

    const moduleRef = await Test.createTestingModule({
      providers: [
        FlightBookingsService,
        { provide: getModelToken(Airline.name), useValue: airlineModel },
        { provide: getModelToken(Flight.name), useValue: flightModel },
        { provide: getModelToken(CabinInventory.name), useValue: cabinModel },
        { provide: getModelToken(FlightBooking.name), useValue: bookingModel },
        { provide: getConnectionToken(), useValue: {} },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        {
          provide: NotificationsService,
          useValue: { createNotification: jest.fn() },
        },
      ],
    }).compile();
    service = moduleRef.get(FlightBookingsService);
  });

  const submit = (passengers: PassengerDetailsDto[]) =>
    service.createBooking(userId.toString(), dtoFor(passengers));

  describe('totals and baggage', () => {
    it('adds extra bags to the held fare and moves to PENDING_PAYMENT', async () => {
      const result = await submit(twoAdults([1, 2]));

      expect(result.status).toBe(BookingStatus.PENDING_PAYMENT);
      expect(result.baseFareTotal).toBe(200); // not repriced
      expect(result.extraBaggageTotal).toBe(120); // 3 bags x 40
      expect(result.taxesAndFees).toBe(0);
      expect(result.totalPrice).toBe(320);
      expect(result.passengers.map((p) => p.extraBaggageFee)).toEqual([40, 80]);
      expect(result.currency).toBe('USD');
    });

    it('rounds money to 2 decimals without float drift', async () => {
      airlines[0].baggagePolicy.extraBagFee = 0.1;
      seedOneWay({ baseFareTotal: 0.2, totalPrice: 0.2 });

      const result = await submit(twoAdults([3, 0]));

      expect(result.extraBaggageTotal).toBe(0.3); // not 0.30000000000000004
      expect(result.totalPrice).toBe(0.5);
    });

    it('charges extra bags on every leg of a round trip, at each airline rate', async () => {
      const returnAirline = makeAirline({ name: 'Delta Jet' });
      returnAirline.baggagePolicy.extraBagFee = 25;
      const returnFlight = makeFlight(returnAirline._id, 120);
      airlines.push(returnAirline);
      flights.push(returnFlight);
      cabins.push(makeCabin(returnFlight._id));
      seedOneWay({
        tripType: TripType.ROUND_TRIP,
        baseFareTotal: 400,
        totalPrice: 400,
      });
      store!.legs.push({
        flight: returnFlight._id,
        cabin: cabins[1]._id,
        cabinClass: CabinClass.ECONOMY,
        departureTime: returnFlight.departureTime,
        arrivalTime: new Date(returnFlight.departureTime.getTime() + 4 * HOUR),
        unitPrice: 100,
      });

      const result = await submit(twoAdults([2, 0]));

      // 2 bags x (40 outbound + 25 return) = 130
      expect(result.passengers[0].extraBaggageFee).toBe(130);
      expect(result.extraBaggageTotal).toBe(130);
      expect(result.totalPrice).toBe(530);
      expect(result.legs).toHaveLength(2);
      expect(result.policies.legs.map((l) => l.airlineName)).toEqual([
        'Nile Air',
        'Delta Jet',
      ]);
    });

    it('applies cabin overrides to the snapshot but not to the fee', async () => {
      cabins[0] = makeCabin(flights[0]._id, {
        checkedBagsIncludedOverride: 2,
        checkedBagMaxWeightKgOverride: 32,
      });
      seedOneWay();

      const result = await submit(twoAdults([1, 0]));

      expect(result.extraBaggageTotal).toBe(40);
      expect(result.policies.legs[0].baggagePolicy.checkedBagsIncluded).toBe(2);
      expect(result.policies.legs[0].baggagePolicy.checkedBagMaxWeightKg).toBe(
        32,
      );
    });

    it('refuses extra bags priced in another currency instead of mixing them', async () => {
      airlines[0].baggagePolicy.currency = 'EUR';

      await expect(submit(twoAdults([1, 0]))).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(bookingModel.findOneAndUpdate).not.toHaveBeenCalled();

      // no extra bags: the mismatch does not matter
      await expect(submit(twoAdults([0, 0]))).resolves.toMatchObject({
        status: BookingStatus.PENDING_PAYMENT,
        totalPrice: 200,
      });
    });
  });

  describe('passenger validation', () => {
    it('rejects a passenger list that does not match the held counts', async () => {
      await expect(submit([adult()])).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        submit([
          adult(),
          adult({ passportNumber: 'B7654321', type: PassengerType.CHILD }),
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects bad dates, duplicate passports and invalid bag counts', async () => {
      const second = { passportNumber: 'B7654321' };
      const cases: Partial<PassengerDetailsDto>[] = [
        { dateOfBirth: '2999-01-01' }, // future
        { dateOfBirth: '1990-02-30' }, // not a date
        { passportExpiry: '2000-01-01' }, // expired
        { extraBaggageCount: -1 }, // negative
        { extraBaggageCount: 1.5 }, // not a whole number
      ];
      for (const bad of cases) {
        await expect(
          submit([adult(bad), adult(second)]),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      await expect(
        submit([adult(), adult()]), // same passport twice
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects extra bags for an infant', async () => {
      seedOneWay({
        passengerCounts: {
          adults: 1,
          children: 0,
          infants: 1,
          totalSeatsRequired: 1,
        },
      });
      await expect(
        submit([
          adult(),
          adult({
            type: PassengerType.INFANT,
            dateOfBirth: dobFor(1),
            passportNumber: 'C1111111',
            extraBaggageCount: 1,
          }),
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a passport that expires before the last flight lands', async () => {
      const arrival = store!.legs[0].arrivalTime;
      const expiry = new Date(arrival.getTime() - 2 * 24 * HOUR)
        .toISOString()
        .slice(0, 10);
      await expect(
        submit([
          adult({ passportExpiry: expiry }),
          adult({ passportNumber: 'B7654321' }),
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);

      // expiring on the arrival day itself is fine
      const sameDay = arrival.toISOString().slice(0, 10);
      await expect(
        submit([
          adult({ passportExpiry: sameDay }),
          adult({ passportNumber: 'B7654321' }),
        ]),
      ).resolves.toBeDefined();
    });

    it('never puts a passport number in an error message or the response', async () => {
      const error = await submit([
        adult({ passportExpiry: '2000-01-01', passportNumber: 'Z9999999' }),
        adult({ passportNumber: 'B7654321' }),
      ]).catch((e: Error) => e);
      expect((error as Error).message).not.toContain('Z9999999');

      const ok = await submit(twoAdults());
      expect(JSON.stringify(ok)).not.toContain('A1234567');
      expect(ok.passengers[0].passportNumber).toBe('****4567');
    });
  });

  describe('passenger type vs age on the outbound departure date', () => {
    const { ADULT, CHILD, INFANT } = PassengerType;
    // [label, type, years old, birthday offset in days, accepted]
    const cases: [string, PassengerType, number, number, boolean][] = [
      ['adult aged 12 (birthday on the departure date)', ADULT, 12, 0, true],
      ['adult aged 30', ADULT, 30, 0, true],
      ['adult aged 11', ADULT, 11, 0, false],
      ['adult turning 12 the day after departure', ADULT, 12, 1, false],
      ['child aged 11', CHILD, 11, 0, true],
      ['child aged 2 (birthday on the departure date)', CHILD, 2, 0, true],
      ['child aged 12', CHILD, 12, 0, false],
      ['child aged 1', CHILD, 1, 0, false],
      ['child turning 2 the day after departure', CHILD, 2, 1, false],
      ['infant aged 1', INFANT, 1, 0, true],
      ['infant turning 2 the day after departure', INFANT, 2, 1, true],
      ['infant aged 2', INFANT, 2, 0, false],
      ['infant aged 8', INFANT, 8, 0, false],
    ];

    it.each(cases)('%s', async (_label, type, years, offset, accepted) => {
      if (type === ADULT) seedCounts(2, 0, 0);
      else if (type === CHILD) seedCounts(1, 1, 0);
      else seedCounts(1, 0, 1);
      const subject = adult({
        type,
        dateOfBirth: dobFor(years, offset),
        passportNumber: 'S1111111',
      });
      const other = adult({ passportNumber: 'O2222222' });
      const list = type === ADULT ? [subject, other] : [other, subject];

      if (accepted) {
        await expect(submit(list)).resolves.toMatchObject({
          status: BookingStatus.PENDING_PAYMENT,
        });
      } else {
        await expect(submit(list)).rejects.toBeInstanceOf(BadRequestException);
        expect(bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
      }
    });

    it('names the passenger and the rule, never the passport number', async () => {
      seedCounts(1, 1, 0);
      const error = await submit([
        adult(),
        adult({
          type: CHILD,
          dateOfBirth: dobFor(14),
          passportNumber: 'S1111111',
        }),
      ]).catch((e: Error) => e);

      expect((error as Error).message).toContain('Passenger 2');
      expect((error as Error).message).toContain('CHILD');
      expect((error as Error).message).not.toContain('S1111111');
    });

    it('uses the outbound departure date, not the return date, on a round trip', async () => {
      addReturnLeg();
      seedCounts(1, 1, 0);
      store!.tripType = TripType.ROUND_TRIP;
      store!.legs = [
        store!.legs[0],
        {
          ...store!.legs[0],
          departureTime: new Date(Date.now() + 120 * HOUR),
          arrivalTime: new Date(Date.now() + 124 * HOUR),
        },
      ];

      // 11 on the outbound date, turns 12 two days later (before the return flight)
      await expect(
        submit([
          adult(),
          adult({
            type: PassengerType.CHILD,
            dateOfBirth: dobFor(12, 2),
            passportNumber: 'S1111111',
          }),
        ]),
      ).resolves.toBeDefined();
    });

    it('requires the passenger counts to equal the hold', async () => {
      seedCounts(1, 1, 0); // hold: 1 adult + 1 child
      await expect(
        submit([adult(), adult({ passportNumber: 'B7654321' })]), // 2 adults
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('extra bags: no invented limits, weight checked against the cabin', () => {
    const bags = (count: number, weight?: number) => [
      adult({ extraBaggageCount: count, extraBaggageWeightKg: weight }),
      adult({ passportNumber: 'B7654321' }),
    ];

    it('charges price per extra bag x bags with no maximum bag count', async () => {
      const result = await submit(bags(20));

      expect(result.passengers[0].extraBaggageFee).toBe(800); // 20 x 40
      expect(result.totalPrice).toBe(1000);
    });

    it('accepts an extra bag at exactly the cabin maximum weight', async () => {
      const result = await submit(bags(1, 23));
      expect(result.extraBaggageTotal).toBe(40);
    });

    it('rejects an extra bag heavier than the cabin maximum', async () => {
      await expect(submit(bags(1, 23.5))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('uses the cabin override of the maximum weight', async () => {
      cabins[0] = makeCabin(flights[0]._id, {
        checkedBagMaxWeightKgOverride: 32,
      });
      seedOneWay();

      await expect(submit(bags(1, 30))).resolves.toBeDefined();
      seedOneWay();
      await expect(submit(bags(1, 33))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('checks every leg: the strictest maximum on a round trip wins', async () => {
      const returnAirline = addReturnLeg();
      returnAirline.baggagePolicy.checkedBagMaxWeightKg = 20;

      await expect(submit(bags(1, 22))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(submit(bags(1, 20))).resolves.toBeDefined();
    });

    it('rejects a bag weight without extra bags', async () => {
      await expect(submit(bags(0, 10))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('does not require a weight', async () => {
      await expect(submit(bags(2))).resolves.toMatchObject({
        extraBaggageTotal: 80,
      });
    });
  });

  describe('FLT-08: airline maximum extra bags per passenger', () => {
    const bags = (first: number, second = 0) => [
      adult({ extraBaggageCount: first }),
      adult({ passportNumber: 'B7654321', extraBaggageCount: second }),
    ];

    it('rejects a passenger above the airline maximum with 400', async () => {
      airlines[0].baggagePolicy.maxExtraBagsPerPassenger = 2;

      await expect(submit(bags(3))).rejects.toBeInstanceOf(BadRequestException);
      await expect(submit(bags(0, 3))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('accepts exactly the maximum', async () => {
      airlines[0].baggagePolicy.maxExtraBagsPerPassenger = 2;

      const result = await submit(bags(2, 2));

      expect(result.extraBaggageTotal).toBe(160); // 4 x 40
    });

    it('a maximum of 0 allows no extra bags at all', async () => {
      airlines[0].baggagePolicy.maxExtraBagsPerPassenger = 0;

      await expect(submit(bags(1))).rejects.toBeInstanceOf(BadRequestException);
      await expect(submit(bags(0))).resolves.toBeDefined();
    });

    it('does not enforce anything when the field is not defined', async () => {
      expect(
        airlines[0].baggagePolicy.maxExtraBagsPerPassenger,
      ).toBeUndefined();

      const result = await submit(bags(20));

      expect(result.passengers[0].extraBaggageFee).toBe(800);
    });

    it('treats a null value in the database like an unset field', async () => {
      (
        airlines[0].baggagePolicy as { maxExtraBagsPerPassenger: number | null }
      ).maxExtraBagsPerPassenger = null;

      await expect(submit(bags(20))).resolves.toBeDefined();
    });

    it('checks every leg against that leg’s own airline', async () => {
      const returnAirline = addReturnLeg();
      airlines[0].baggagePolicy.maxExtraBagsPerPassenger = 5; // outbound allows 5
      returnAirline.baggagePolicy.maxExtraBagsPerPassenger = 1; // return allows 1

      const error = await submit(bags(2)).catch((e: Error) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toContain('Delta Jet');
      await expect(submit(bags(1))).resolves.toBeDefined();
    });

    it('lets an airline without a maximum through while the other enforces one', async () => {
      const returnAirline = addReturnLeg();
      airlines[0].baggagePolicy.maxExtraBagsPerPassenger = 3; // outbound allows 3
      expect(
        returnAirline.baggagePolicy.maxExtraBagsPerPassenger,
      ).toBeUndefined();

      await expect(submit(bags(4))).rejects.toBeInstanceOf(BadRequestException);
      await expect(submit(bags(3))).resolves.toBeDefined();
    });
  });

  describe('no passenger cap', () => {
    it('accepts more than 9 passengers when they match the hold', async () => {
      seedCounts(12, 0, 0);
      store!.baseFareTotal = 1200;
      store!.totalPrice = 1200;
      const passengers = Array.from({ length: 12 }, (_, i) =>
        adult({ passportNumber: `P${1000000 + i}` }),
      );

      const result = await submit(passengers);

      expect(result.passengers).toHaveLength(12);
      expect(result.totalPrice).toBe(1200);
    });
  });

  describe('ownership, status and expiry', () => {
    it('returns 404 for another user’s booking, scoped by owner in the query', async () => {
      await expect(
        service.createBooking(
          new Types.ObjectId().toString(),
          dtoFor(twoAdults()),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown or malformed booking id', async () => {
      await expect(
        service.createBooking(userId.toString(), {
          bookingId: new Types.ObjectId().toString(),
          passengers: twoAdults(),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.createBooking(userId.toString(), {
          bookingId: 'nope',
          passengers: twoAdults(),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('detects a second submit by the passengers already being there, not by the status', async () => {
      seedOneWay({ passengers: [{ firstName: 'Layla' }] });
      expect(store!.status).toBe(BookingStatus.PENDING_PAYMENT);

      await expect(submit(twoAdults())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(bookingModel.findOneAndUpdate).not.toHaveBeenCalled();

      // even if the pre-check were skipped, the atomic update refuses it too
      bookingModel.findOne.mockResolvedValueOnce({ ...store, passengers: [] });
      await expect(submit(twoAdults())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(store!.passengers).toHaveLength(1);
    });

    it('returns 409 once the hold has expired, even if the cron has not run yet', async () => {
      seedOneWay({ holdExpiresAt: new Date(Date.now() - 1000) });
      await expect(submit(twoAdults())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it.each([
      BookingStatus.HELD, // legacy status, no longer part of the lifecycle
      BookingStatus.EXPIRED,
      BookingStatus.CANCELLED,
      BookingStatus.CONFIRMED,
      BookingStatus.COMPLETED,
    ])('returns 409 for a %s booking', async (status) => {
      seedOneWay({ status });
      await expect(submit(twoAdults())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(bookingModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 409 when the flight was cancelled or the airline deactivated after the hold', async () => {
      flights[0].status = FlightStatus.CANCELLED;
      await expect(submit(twoAdults())).rejects.toBeInstanceOf(
        ConflictException,
      );

      flights[0].status = FlightStatus.SCHEDULED;
      airlines[0].isActive = false;
      await expect(submit(twoAdults())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('lets exactly one of two simultaneous submissions win', async () => {
      const results = await Promise.allSettled([
        submit(twoAdults([1, 0])),
        submit(twoAdults([2, 0])),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(store!.status).toBe(BookingStatus.PENDING_PAYMENT);
    });

    it('turns a lost race with the expiry cron into a 409, not a silent success', async () => {
      // the hold is valid when read but gone by the time of the atomic update
      bookingModel.findOneAndUpdate.mockResolvedValueOnce(null);
      await expect(submit(twoAdults())).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('the atomic update and the snapshot', () => {
    it('is one conditional update on owner + PENDING_PAYMENT + unexpired hold + no passengers yet', async () => {
      await submit(twoAdults([1, 0]));

      expect(bookingModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      const { filter } = lastUpdate();
      expect(filter.status).toBe(BookingStatus.PENDING_PAYMENT);
      expect(filter.user.equals(userId)).toBe(true);
      expect(filter.holdExpiresAt.$gt).toBeInstanceOf(Date);
      expect(filter['passengers.0']).toEqual({ $exists: false });
    });

    it('fills in the details without touching the status', async () => {
      const result = await submit(twoAdults([1, 0]));

      expect(lastUpdate().update.$set).not.toHaveProperty('status');
      expect(result.status).toBe(BookingStatus.PENDING_PAYMENT);
      expect(store!.status).toBe(BookingStatus.PENDING_PAYMENT);
      expect(store!.passengers).toHaveLength(2);
    });

    it('never confirms, never extends the hold, never issues tickets or seats', async () => {
      const before = store!.holdExpiresAt.getTime();
      await submit(twoAdults());

      const { update } = lastUpdate();
      expect(update.$set.status).not.toBe(BookingStatus.CONFIRMED);
      expect(update.$set).not.toHaveProperty('holdExpiresAt');
      expect(update.$set).not.toHaveProperty('confirmedAt');
      expect(update.$set).not.toHaveProperty('policyAcceptedAt');
      expect(store!.holdExpiresAt.getTime()).toBe(before);
      const passengers = update.$set.passengers as Record<string, unknown>[];
      for (const passenger of passengers) {
        expect(passenger).not.toHaveProperty('eTicketNumber');
        expect(passenger).not.toHaveProperty('seatAssignments');
      }
    });

    it('stores normalised passengers (trimmed, upper-cased, UTC dates)', async () => {
      await submit([
        adult({ firstName: '  Layla ', passportNumber: 'a1234567' }),
        adult({ passportNumber: 'B7654321' }),
      ]);

      const [first] = lastUpdate().update.$set.passengers as Record<
        string,
        unknown
      >[];
      expect(first.firstName).toBe('Layla');
      expect(first.passportNumber).toBe('A1234567');
      expect(first.nationality).toBe('EG');
      expect((first.dateOfBirth as Date).toISOString()).toBe(
        '1990-05-17T00:00:00.000Z',
      );
    });

    it('snapshots both policies per leg as plain objects with capturedAt', async () => {
      const before = Date.now();
      const result = await submit(twoAdults());
      const { policySnapshot } = lastUpdate().update.$set as {
        policySnapshot: {
          capturedAt: Date;
          legs: {
            flightId: string;
            airlineId: string;
            baggagePolicy: Record<string, unknown>;
            cancellationPolicy: Record<string, unknown>;
          }[];
        };
      };

      expect(policySnapshot.capturedAt.getTime()).toBeGreaterThanOrEqual(
        before,
      );
      const [leg] = policySnapshot.legs;
      expect(leg.flightId).toBe(flights[0]._id.toString());
      expect(leg.airlineId).toBe(airlines[0]._id.toString());
      expect(leg.baggagePolicy).toEqual({
        carryOnBagsIncluded: 1,
        carryOnMaxWeightKg: 7,
        carryOnMaxDimensions: '55x40x20',
        checkedBagsIncluded: 1,
        checkedBagMaxWeightKg: 23,
        extraBagFee: 40,
        overweightFeePerKg: 15,
        currency: 'USD',
        notes: null,
      });
      expect(leg.cancellationPolicy).toEqual({
        allowCancellation: true,
        freeCancellationHoursBeforeDeparture: 24,
        cancellationFeePercentage: 20,
        fixedCancellationFee: 5,
        refundPercentageAfterCutoff: 10,
        currency: 'USD',
        termsText: 'Be kind to the airline',
      });

      // plain data only: survives a JSON round trip unchanged in shape
      const roundTrip = JSON.parse(JSON.stringify(policySnapshot)) as {
        legs: unknown[];
      };
      expect(roundTrip.legs).toHaveLength(1);
      expect(Object.getPrototypeOf(leg.baggagePolicy)).toBe(Object.prototype);
      expect(Object.keys(result.policies)).toEqual(['capturedAt', 'legs']);
    });

    it('returns an explicit response without Mongoose internals', async () => {
      const result = await submit(twoAdults());

      expect(Object.keys(result).sort()).toEqual(
        [
          'id',
          'bookingReference',
          'status',
          'tripType',
          'holdExpiresAt',
          'passengerCounts',
          'passengers',
          'legs',
          'baseFareTotal',
          'extraBaggageTotal',
          'taxesAndFees',
          'totalPrice',
          'currency',
          'policies',
        ].sort(),
      );
      expect(JSON.stringify(result)).not.toMatch(/\$__|session|_doc/);
    });
  });
});
