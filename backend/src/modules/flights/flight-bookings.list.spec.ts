import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import {
  BookingStatus,
  CabinClass,
  PassengerType,
  TripType,
} from '../../common/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { ListFlightBookingsQueryDto } from './dto/list-flight-bookings-query.dto';
import { FlightBookingsService } from './flight-bookings.service';
import { Airline } from './schemas/airline.schema';
import { CabinInventory } from './schemas/cabin-inventory.schema';
import { FlightBooking } from './schemas/flight-booking.schema';
import { Flight } from './schemas/flight.schema';

const MINUTE = 60_000;
const userId = new Types.ObjectId();

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    user: userId,
    bookingReference: 'ABCD2345',
    status: BookingStatus.CONFIRMED,
    tripType: TripType.ONE_WAY,
    holdExpiresAt: new Date(Date.now() - 60 * MINUTE),
    legs: [
      {
        flight: new Types.ObjectId(),
        cabin: new Types.ObjectId(),
        cabinClass: CabinClass.ECONOMY,
        departureTime: new Date('2027-01-01T10:00:00Z'),
        arrivalTime: new Date('2027-01-01T14:00:00Z'),
        unitPrice: 100,
      },
    ],
    passengers: [
      {
        _id: new Types.ObjectId(),
        firstName: 'Layla',
        lastName: 'Hassan',
        type: PassengerType.ADULT,
        passportNumber: 'A1234567',
        extraBaggageCount: 0,
        extraBaggageFee: 0,
        seatAssignments: ['12A'],
        eTicketNumber: 'ETK-SECRET-1',
      },
    ],
    passengerCounts: {
      adults: 1,
      children: 0,
      infants: 0,
      totalSeatsRequired: 1,
    },
    baseFareTotal: 100,
    extraBaggageTotal: 0,
    taxesAndFees: 0,
    totalPrice: 100,
    currency: 'USD',
    policySnapshot: { capturedAt: new Date(), legs: [] },
    payment: new Types.ObjectId(),
    createdAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  };
}

function query(
  overrides: Partial<ListFlightBookingsQueryDto> = {},
): ListFlightBookingsQueryDto {
  return Object.assign(new ListFlightBookingsQueryDto(), overrides);
}

describe('FlightBookingsService.listBookings', () => {
  let service: FlightBookingsService;
  let expireHold: jest.SpyInstance;
  let docs: ReturnType<typeof makeBooking>[];
  let lapsed: { _id: Types.ObjectId }[];
  let total: number;
  let calls: {
    filter?: Record<string, unknown>;
    sort?: Record<string, number>;
    skip?: number;
    limit?: number;
  };
  let lapsedFilter: Record<string, unknown> | undefined;

  const bookingModel = {
    find: jest.fn(),
    countDocuments: jest.fn(),
  };

  beforeEach(async () => {
    docs = [];
    lapsed = [];
    total = 0;
    calls = {};
    lapsedFilter = undefined;

    bookingModel.find.mockImplementation((filter: Record<string, unknown>) => ({
      // expireLapsedHoldsFor: find().select().limit().lean()
      select: () => {
        lapsedFilter = filter;
        return { limit: () => ({ lean: () => Promise.resolve(lapsed) }) };
      },
      // listBookings: find().sort().skip().limit()
      sort: (sort: Record<string, number>) => {
        calls = { filter, sort };
        return {
          skip: (skip: number) => {
            calls.skip = skip;
            return {
              limit: (limit: number) => {
                calls.limit = limit;
                return Promise.resolve(docs);
              },
            };
          },
        };
      },
    }));
    bookingModel.countDocuments.mockImplementation(() =>
      Promise.resolve(total),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        FlightBookingsService,
        { provide: getModelToken(Airline.name), useValue: {} },
        { provide: getModelToken(Flight.name), useValue: {} },
        { provide: getModelToken(CabinInventory.name), useValue: {} },
        { provide: getModelToken(FlightBooking.name), useValue: bookingModel },
        { provide: getConnectionToken(), useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: NotificationsService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(FlightBookingsService);
    expireHold = jest.spyOn(service, 'expireHold').mockResolvedValue(true);
  });

  afterEach(() => jest.clearAllMocks());

  describe('owner scoping', () => {
    it('always filters by the current user id', async () => {
      await service.listBookings(userId.toString(), query());

      expect(calls.filter?.user).toEqual(userId);
      expect(bookingModel.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ user: userId }),
      );
    });

    it('scopes the lapsed-hold sweep to the same user', async () => {
      await service.listBookings(userId.toString(), query());

      expect(lapsedFilter?.user).toEqual(userId);
    });

    it('does not read an owner from the query object', async () => {
      const other = new Types.ObjectId();
      const tampered = Object.assign(query(), { user: other, userId: other });

      await service.listBookings(userId.toString(), tampered);

      expect(calls.filter).toEqual({ user: userId });
    });
  });

  describe('pagination', () => {
    it('defaults to page 1, limit 10, newest first', async () => {
      const result = await service.listBookings(userId.toString(), query());

      expect(calls.skip).toBe(0);
      expect(calls.limit).toBe(10);
      expect(calls.sort).toEqual({ createdAt: -1, _id: -1 });
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
      expect(result.data).toEqual([]);
    });

    it('skips (page - 1) * limit', async () => {
      total = 45;
      const result = await service.listBookings(
        userId.toString(),
        query({ page: 3, limit: 20 }),
      );

      expect(calls.skip).toBe(40);
      expect(calls.limit).toBe(20);
      expect(result.meta).toEqual({
        page: 3,
        limit: 20,
        total: 45,
        totalPages: 3,
      });
    });

    it.each([
      [0, 10, 0],
      [1, 10, 1],
      [10, 10, 1],
      [11, 10, 2],
      [100, 50, 2],
    ])('total %i with limit %i gives %i page(s)', async (t, limit, pages) => {
      total = t;
      const result = await service.listBookings(
        userId.toString(),
        query({ limit }),
      );

      expect(result.meta.totalPages).toBe(pages);
    });

    it('returns an empty page with the real total when the page is out of range', async () => {
      total = 3;
      docs = [];
      const result = await service.listBookings(
        userId.toString(),
        query({ page: 99 }),
      );

      expect(result.data).toEqual([]);
      expect(result.meta).toEqual({
        page: 99,
        limit: 10,
        total: 3,
        totalPages: 1,
      });
    });
  });

  describe('status filter', () => {
    it('adds no status condition when none is given', async () => {
      await service.listBookings(userId.toString(), query());

      expect(calls.filter).not.toHaveProperty('status');
    });

    it('filters by a single status', async () => {
      await service.listBookings(
        userId.toString(),
        query({ status: [BookingStatus.CONFIRMED] }),
      );

      expect(calls.filter?.status).toEqual({ $in: [BookingStatus.CONFIRMED] });
    });

    it('filters by several statuses', async () => {
      const statuses = [BookingStatus.CONFIRMED, BookingStatus.COMPLETED];
      await service.listBookings(
        userId.toString(),
        query({ status: statuses }),
      );

      expect(calls.filter?.status).toEqual({ $in: statuses });
      expect(bookingModel.countDocuments).toHaveBeenCalledWith({
        user: userId,
        status: { $in: statuses },
      });
    });
  });

  describe('sorting', () => {
    it.each([
      ['createdAt', 'asc', { createdAt: 1 }],
      ['createdAt', 'desc', { createdAt: -1 }],
      ['totalPrice', 'asc', { totalPrice: 1 }],
      ['totalPrice', 'desc', { totalPrice: -1 }],
      ['departureDate', 'asc', { 'legs.0.departureTime': 1 }],
      ['departureDate', 'desc', { 'legs.0.departureTime': -1 }],
    ] as const)('sortBy %s %s', async (sortBy, sortOrder, expected) => {
      await service.listBookings(
        userId.toString(),
        query({ sortBy, sortOrder }),
      );

      const direction = sortOrder === 'asc' ? 1 : -1;
      expect(calls.sort).toEqual({ ...expected, _id: direction });
    });

    it.each(['passengers.passportNumber', 'constructor', '$where'])(
      'refuses sortBy=%s even if it got past the DTO',
      async (sortBy) => {
        await expect(
          service.listBookings(
            userId.toString(),
            query({ sortBy: sortBy as never }),
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(calls.sort).toBeUndefined();
      },
    );
  });

  describe('expiry consistency (FLT-22)', () => {
    it('expires this user’s lapsed holds through expireHold before listing', async () => {
      const a = new Types.ObjectId();
      const b = new Types.ObjectId();
      lapsed = [{ _id: a }, { _id: b }];

      await service.listBookings(userId.toString(), query());

      expect(lapsedFilter).toMatchObject({
        user: userId,
        status: { $in: [BookingStatus.HELD, BookingStatus.PENDING_PAYMENT] },
        holdExpiresAt: { $lte: expect.any(Date) as Date },
      });
      expect(expireHold).toHaveBeenCalledTimes(2);
      expect(expireHold).toHaveBeenCalledWith(a, expect.any(Date));
      expect(expireHold).toHaveBeenCalledWith(b, expect.any(Date));
      // the sweep runs before the page is read
      expect(bookingModel.find.mock.invocationCallOrder[0]).toBeLessThan(
        bookingModel.find.mock.invocationCallOrder[1],
      );
    });

    it('does not touch holds that are still running', async () => {
      lapsed = [];

      await service.listBookings(userId.toString(), query());

      expect(expireHold).not.toHaveBeenCalled();
    });

    it('never reports a lapsed hold as PENDING_PAYMENT, even if expiring it failed', async () => {
      lapsed = [{ _id: new Types.ObjectId() }];
      expireHold.mockRejectedValue(new Error('transaction failed'));
      docs = [
        makeBooking({
          status: BookingStatus.PENDING_PAYMENT,
          holdExpiresAt: new Date(Date.now() - MINUTE),
        }),
        makeBooking({
          status: BookingStatus.PENDING_PAYMENT,
          holdExpiresAt: new Date(Date.now() + 5 * MINUTE),
        }),
      ];

      const result = await service.listBookings(userId.toString(), query());

      expect(result.data.map((b) => b.status)).toEqual([
        BookingStatus.EXPIRED,
        BookingStatus.PENDING_PAYMENT,
      ]);
    });

    it('does not rewrite the status of confirmed bookings whose hold time is long past', async () => {
      docs = [makeBooking({ status: BookingStatus.CONFIRMED })];

      const result = await service.listBookings(userId.toString(), query());

      expect(result.data[0].status).toBe(BookingStatus.CONFIRMED);
    });
  });

  describe('response items', () => {
    it('returns the create-endpoint fields, masks passports and leaks nothing internal', async () => {
      docs = [makeBooking()];
      total = 1;

      const [item] = (await service.listBookings(userId.toString(), query()))
        .data;

      expect(Object.keys(item).sort()).toEqual(
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
          'createdAt',
        ].sort(),
      );
      expect(item.passengers[0].passportNumber).toBe('****4567');
      const json = JSON.stringify(item);
      expect(json).not.toContain('A1234567');
      expect(json).not.toContain('ETK-SECRET-1');
      expect(json).not.toContain('"payment"');
      expect(json).not.toContain('"user"');
    });

    it('returns policies: null for a hold that has no passenger details yet', async () => {
      docs = [
        makeBooking({
          status: BookingStatus.PENDING_PAYMENT,
          holdExpiresAt: new Date(Date.now() + 5 * MINUTE),
          passengers: [],
          policySnapshot: undefined,
        }),
      ];

      const [item] = (await service.listBookings(userId.toString(), query()))
        .data;

      expect(item.policies).toBeNull();
      expect(item.passengers).toEqual([]);
    });
  });
});
