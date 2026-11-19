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
  NotificationType,
  TripType,
} from '../../common/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { HoldSeatsDto } from './dto/hold-seats.dto';
import { FlightBookingsService } from './flight-bookings.service';
import { Airline } from './schemas/airline.schema';
import { CabinInventory } from './schemas/cabin-inventory.schema';
import { FlightBooking } from './schemas/flight-booking.schema';
import { Flight } from './schemas/flight.schema';

const HOUR = 3_600_000;
const airportA = new Types.ObjectId();
const airportB = new Types.ObjectId();

function makeFlight(overrides: Partial<Flight> = {}) {
  return {
    _id: new Types.ObjectId(),
    airline: new Types.ObjectId(),
    flightNumber: 'PP100',
    departureAirport: airportA,
    arrivalAirport: airportB,
    departureTime: new Date(Date.now() + 48 * HOUR),
    arrivalTime: new Date(Date.now() + 52 * HOUR),
    status: FlightStatus.SCHEDULED,
    ...overrides,
  };
}

function makeCabin(flightId: Types.ObjectId, overrides = {}) {
  return {
    _id: new Types.ObjectId(),
    flight: flightId,
    cabinClass: CabinClass.ECONOMY,
    basePrice: 100,
    childPrice: 60,
    infantPrice: 5, // ignored: infants pay 10% of the cabin fare
    currency: 'USD',
    isActive: true,
    ...overrides,
  };
}

const withSession = <T>(value: T) => ({
  session: jest.fn().mockResolvedValue(value),
});

describe('FlightBookingsService', () => {
  let service: FlightBookingsService;
  const flights = new Map<string, ReturnType<typeof makeFlight>>();
  const cabins = new Map<string, ReturnType<typeof makeCabin>>();
  let airlineActive = true;

  const flightModel = {
    findById: jest.fn((id: string) => withSession(flights.get(id) ?? null)),
  };
  const airlineModel = {
    findById: jest.fn(() =>
      withSession({ _id: new Types.ObjectId(), isActive: airlineActive }),
    ),
  };
  const cabinModel = {
    findOne: jest.fn(
      (filter: { flight: Types.ObjectId; cabinClass: CabinClass }) => {
        const cabin = cabins.get(filter.flight.toString());
        return withSession(
          cabin?.cabinClass === filter.cabinClass ? cabin : null,
        );
      },
    ),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };
  const bookingModel = {
    create: jest.fn(),
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
  };
  const config = { get: jest.fn() };
  const session = {};
  const connection = {
    transaction: jest.fn((fn: (s: unknown) => Promise<unknown>) => fn(session)),
  };
  const notifications = { createNotification: jest.fn() };

  const holdDto = (overrides: Partial<HoldSeatsDto> = {}): HoldSeatsDto => ({
    tripType: TripType.ONE_WAY,
    legs: [
      { flightId: [...flights.keys()][0], cabinClass: CabinClass.ECONOMY },
    ],
    adults: 1,
    children: 0,
    infants: 0,
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    flights.clear();
    cabins.clear();
    airlineActive = true;

    const flight = makeFlight();
    flights.set(flight._id.toString(), flight);
    cabins.set(flight._id.toString(), makeCabin(flight._id));

    config.get.mockReturnValue(undefined);
    cabinModel.findOneAndUpdate.mockResolvedValue({ _id: 'cabin' });
    bookingModel.create.mockImplementation(([doc]: Record<string, unknown>[]) =>
      Promise.resolve([{ _id: new Types.ObjectId(), ...doc }]),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        FlightBookingsService,
        { provide: getModelToken(Airline.name), useValue: airlineModel },
        { provide: getModelToken(Flight.name), useValue: flightModel },
        { provide: getModelToken(CabinInventory.name), useValue: cabinModel },
        { provide: getModelToken(FlightBooking.name), useValue: bookingModel },
        { provide: getConnectionToken(), useValue: connection },
        { provide: ConfigService, useValue: config },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(FlightBookingsService);
  });

  describe('holdSeats', () => {
    it('holds seats atomically and creates a HELD booking', async () => {
      const dto = holdDto({ adults: 1, children: 1, infants: 1 });
      const before = Date.now();

      const result = await service.holdSeats(
        new Types.ObjectId().toString(),
        dto,
      );

      // infants need no seat: 1 adult + 1 child = 2 seats
      const [filter, update] = cabinModel.findOneAndUpdate.mock.calls[0] as [
        { availableSeats: { $gte: number } },
        { $inc: Record<string, number> },
      ];
      expect(filter.availableSeats).toEqual({ $gte: 2 });
      expect(update.$inc).toEqual({ availableSeats: -2, heldSeats: 2 });

      expect(result.status).toBe(BookingStatus.HELD);
      expect(result.passengerCounts.totalSeatsRequired).toBe(2);
      expect(result.baseFareTotal).toBe(170); // 100 + 60 + 10% of 100
      expect(result.bookingReference).toMatch(/^[A-Z2-9]{8}$/);
      const heldFor = result.holdExpiresAt.getTime() - before;
      expect(heldFor).toBeGreaterThanOrEqual(10 * 60_000 - 1000);
      expect(heldFor).toBeLessThan(10 * 60_000 + 5000);
    });

    it('rejects with Conflict when seats ran out (no overselling)', async () => {
      cabinModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(
        service.holdSeats(new Types.ObjectId().toString(), holdDto()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(bookingModel.create).not.toHaveBeenCalled();
    });

    it('rejects infants outnumbering adults before touching the database', async () => {
      await expect(
        service.holdSeats(
          new Types.ObjectId().toString(),
          holdDto({ adults: 1, infants: 2 }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(connection.transaction).not.toHaveBeenCalled();
    });

    it('has no passenger cap: 20 seats are held when the cabin has them', async () => {
      const result = await service.holdSeats(
        new Types.ObjectId().toString(),
        holdDto({ adults: 12, children: 8, infants: 3 }),
      );

      const [filter, update] = cabinModel.findOneAndUpdate.mock.calls[0] as [
        { availableSeats: { $gte: number } },
        { $inc: Record<string, number> },
      ];
      expect(filter.availableSeats).toEqual({ $gte: 20 });
      expect(update.$inc).toEqual({ availableSeats: -20, heldSeats: 20 });
      expect(result.passengerCounts.totalSeatsRequired).toBe(20);
    });

    it('leaves the limit to seat availability (409 when the cabin is too small)', async () => {
      cabinModel.findOneAndUpdate.mockResolvedValue(null);
      await expect(
        service.holdSeats(
          new Types.ObjectId().toString(),
          holdDto({ adults: 30 }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('holds for 10 minutes by default and honours FLIGHT_HOLD_MINUTES', async () => {
      const heldFor = async () => {
        const before = Date.now();
        const hold = await service.holdSeats(
          new Types.ObjectId().toString(),
          holdDto(),
        );
        return hold.holdExpiresAt.getTime() - before;
      };
      expect(await heldFor()).toBeLessThan(10 * 60_000 + 5000);
      config.get.mockReturnValue('20');
      expect(await heldFor()).toBeGreaterThanOrEqual(20 * 60_000 - 1000);
      config.get.mockReturnValue('nonsense');
      expect(await heldFor()).toBeLessThan(10 * 60_000 + 5000);
    });

    describe('infants', () => {
      it('take no seat and pay 10% of the cabin fare', async () => {
        const result = await service.holdSeats(
          new Types.ObjectId().toString(),
          holdDto({ adults: 2, children: 0, infants: 2 }),
        );

        const [, update] = cabinModel.findOneAndUpdate.mock.calls[0] as [
          unknown,
          { $inc: Record<string, number> },
        ];
        expect(update.$inc).toEqual({ availableSeats: -2, heldSeats: 2 });
        expect(result.passengerCounts.totalSeatsRequired).toBe(2);
        expect(result.baseFareTotal).toBe(220); // 2 x 100 + 2 x 10
      });

      it('round the 10% to cents and ignore any stored infantPrice', async () => {
        const [id] = [...flights.keys()];
        cabins.set(id, makeCabin(flights.get(id)!._id, { basePrice: 333.33 }));

        const result = await service.holdSeats(
          new Types.ObjectId().toString(),
          holdDto({ adults: 1, children: 0, infants: 1 }),
        );

        expect(result.baseFareTotal).toBe(366.66); // 333.33 + 33.33
      });
    });

    it('rejects a round trip that does not have two legs', async () => {
      await expect(
        service.holdSeats(
          new Types.ObjectId().toString(),
          holdDto({ tripType: TripType.ROUND_TRIP }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects cancelled flights, past flights and deactivated airlines', async () => {
      const [id] = [...flights.keys()];
      const userId = new Types.ObjectId().toString();

      flights.get(id)!.status = FlightStatus.CANCELLED;
      await expect(service.holdSeats(userId, holdDto())).rejects.toBeInstanceOf(
        ConflictException,
      );

      flights.get(id)!.status = FlightStatus.SCHEDULED;
      flights.get(id)!.departureTime = new Date(Date.now() - HOUR);
      await expect(service.holdSeats(userId, holdDto())).rejects.toBeInstanceOf(
        ConflictException,
      );

      flights.get(id)!.departureTime = new Date(Date.now() + 48 * HOUR);
      airlineActive = false;
      await expect(service.holdSeats(userId, holdDto())).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(cabinModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown flight or cabin', async () => {
      const userId = new Types.ObjectId().toString();
      await expect(
        service.holdSeats(
          userId,
          holdDto({
            legs: [
              {
                flightId: new Types.ObjectId().toString(),
                cabinClass: CabinClass.ECONOMY,
              },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      await expect(
        service.holdSeats(
          userId,
          holdDto({
            legs: [
              {
                flightId: [...flights.keys()][0],
                cabinClass: CabinClass.FIRST,
              },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    describe('round trip', () => {
      function addReturnFlight(overrides: Partial<Flight> = {}) {
        const inbound = makeFlight({
          flightNumber: 'PP101',
          departureAirport: airportB,
          arrivalAirport: airportA,
          departureTime: new Date(Date.now() + 100 * HOUR),
          arrivalTime: new Date(Date.now() + 104 * HOUR),
          ...overrides,
        });
        flights.set(inbound._id.toString(), inbound);
        cabins.set(inbound._id.toString(), makeCabin(inbound._id));
        return inbound;
      }

      const roundTrip = (inboundId: string) =>
        holdDto({
          tripType: TripType.ROUND_TRIP,
          legs: [
            {
              flightId: [...flights.keys()][0],
              cabinClass: CabinClass.ECONOMY,
            },
            { flightId: inboundId, cabinClass: CabinClass.ECONOMY },
          ],
          adults: 2,
        });

      it('holds both legs in one transaction', async () => {
        const inbound = addReturnFlight();

        const result = await service.holdSeats(
          new Types.ObjectId().toString(),
          roundTrip(inbound._id.toString()),
        );

        expect(connection.transaction).toHaveBeenCalledTimes(1);
        expect(cabinModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
        expect(result.legs).toHaveLength(2);
        expect(result.baseFareTotal).toBe(400); // 2 adults x 100 x 2 legs
      });

      it('charges an infant 10% of the cabin fare on every leg', async () => {
        const inbound = addReturnFlight();

        const result = await service.holdSeats(
          new Types.ObjectId().toString(),
          {
            ...roundTrip(inbound._id.toString()),
            infants: 1,
          },
        );

        expect(result.baseFareTotal).toBe(420); // 2 x 200 + 2 x 10
        expect(result.passengerCounts.totalSeatsRequired).toBe(2);
      });

      it('rejects a return flight that is not the reverse route', async () => {
        const inbound = addReturnFlight({
          arrivalAirport: new Types.ObjectId(),
        });

        await expect(
          service.holdSeats(
            new Types.ObjectId().toString(),
            roundTrip(inbound._id.toString()),
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(cabinModel.findOneAndUpdate).not.toHaveBeenCalled();
      });

      it('rejects a return flight leaving before the outbound lands', async () => {
        const inbound = addReturnFlight({
          departureTime: new Date(Date.now() + 49 * HOUR),
        });

        await expect(
          service.holdSeats(
            new Types.ObjectId().toString(),
            roundTrip(inbound._id.toString()),
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });
  });

  describe('expireHold', () => {
    const cabinA = new Types.ObjectId();
    const cabinB = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const expiredBooking = {
      _id: new Types.ObjectId(),
      user: userId,
      bookingReference: 'ABCD2345',
      passengerCounts: { totalSeatsRequired: 3 },
      legs: [{ cabin: cabinA }, { cabin: cabinB }],
    };

    it('returns the seats of every leg and notifies the user', async () => {
      bookingModel.findOneAndUpdate.mockResolvedValue(expiredBooking);
      cabinModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await service.expireHold(expiredBooking._id, new Date());

      expect(result).toBe(true);
      expect(cabinModel.updateOne).toHaveBeenCalledTimes(2);
      expect(cabinModel.updateOne).toHaveBeenCalledWith(
        { _id: cabinA, heldSeats: { $gte: 3 } },
        { $inc: { heldSeats: -3, availableSeats: 3 } },
        { session },
      );
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: userId,
          type: NotificationType.BOOKING_HOLD_EXPIRED,
        }),
      );
    });

    it('does nothing when the hold was already handled (idempotent)', async () => {
      bookingModel.findOneAndUpdate.mockResolvedValue(null);

      const result = await service.expireHold(expiredBooking._id, new Date());

      expect(result).toBe(false);
      expect(cabinModel.updateOne).not.toHaveBeenCalled();
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('still expires the hold if the notification fails', async () => {
      bookingModel.findOneAndUpdate.mockResolvedValue(expiredBooking);
      cabinModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
      notifications.createNotification.mockRejectedValue(new Error('boom'));

      await expect(
        service.expireHold(expiredBooking._id, new Date()),
      ).resolves.toBe(true);
    });
  });

  describe('expireStaleHolds', () => {
    it('expires every stale hold the query returns', async () => {
      const ids = [new Types.ObjectId(), new Types.ObjectId()];
      bookingModel.find.mockReturnValue({
        select: () => ({
          limit: () => ({
            lean: () => Promise.resolve(ids.map((_id) => ({ _id }))),
          }),
        }),
      });
      const spy = jest.spyOn(service, 'expireHold').mockResolvedValue(true);

      await expect(service.expireStaleHolds()).resolves.toBe(2);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});
