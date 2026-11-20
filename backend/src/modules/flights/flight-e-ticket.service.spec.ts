import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  BookingStatus,
  CabinClass,
  PassengerType,
  Role,
  TripType,
} from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { FlightETicketService } from './flight-e-ticket.service';

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

const ownerId = new Types.ObjectId();
const airlineId = new Types.ObjectId();
const otherAirlineId = new Types.ObjectId();

const cairo = {
  _id: new Types.ObjectId(),
  iataCode: 'CAI',
  name: 'Cairo Intl',
  cityName: 'Cairo',
  timezone: 'Africa/Cairo',
};
const dubai = {
  _id: new Types.ObjectId(),
  iataCode: 'DXB',
  name: 'Dubai Intl',
  timezone: 'Asia/Dubai',
};
const flight = {
  _id: new Types.ObjectId(),
  status: 'SCHEDULED',
  airline: airlineId,
  flightNumber: 'NA100',
  departureAirport: cairo._id,
  arrivalAirport: dubai._id,
  durationMinutes: 240,
};
const airline = { _id: airlineId, name: 'Nile Air', iataCode: 'NA' };

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    user: ownerId,
    bookingReference: 'ABCD2345',
    status: BookingStatus.CONFIRMED,
    tripType: TripType.ONE_WAY,
    confirmedAt: new Date('2026-11-19T10:00:00Z'),
    legs: [
      {
        flight: flight._id,
        cabinClass: CabinClass.ECONOMY,
        departureTime: new Date('2026-12-01T12:30:00Z'),
        arrivalTime: new Date('2026-12-01T16:30:00Z'),
        seatNumbers: [],
      },
    ],
    passengers: [
      {
        firstName: 'Layla',
        lastName: 'Hassan',
        type: PassengerType.ADULT,
        eTicketNumber: 'ETKABCD234501',
        passportNumber: 'A12345678',
        extraBaggageCount: 0,
        seatAssignments: [],
      },
    ],
    totalPrice: 300,
    currency: 'USD',
    ...overrides,
  };
}

function build(booking: ReturnType<typeof makeBooking> | null) {
  const bookingModel = {
    findById: jest.fn(() => query(booking)),
  };
  const flightModel = {
    find: jest.fn(() => query([flight])),
    exists: jest.fn().mockResolvedValue(null),
  };
  const airlineModel = { find: jest.fn(() => query([airline])) };
  const airportModel = { find: jest.fn(() => query([cairo, dubai])) };
  const service = new FlightETicketService(
    bookingModel as never,
    flightModel as never,
    airlineModel as never,
    airportModel as never,
  );
  return { service, bookingModel, flightModel, airlineModel };
}

const owner: AuthenticatedUser = {
  userId: ownerId.toString(),
  email: 'o@example.com',
  role: Role.REGISTERED_USER,
  jti: 'j',
};

describe('FlightETicketService.getETicket', () => {
  it('returns the PNR, e-ticket numbers and airport time zones for the owner', async () => {
    const booking = makeBooking();
    const { service } = build(booking);

    const ticket = await service.getETicket(owner, booking._id.toString());

    expect(ticket.bookingReference).toBe('ABCD2345');
    expect(ticket.status).toBe(BookingStatus.CONFIRMED);
    expect(ticket.issuedAt).toEqual(booking.confirmedAt);
    expect(ticket.passengers).toEqual([
      {
        firstName: 'Layla',
        lastName: 'Hassan',
        type: PassengerType.ADULT,
        eTicketNumber: 'ETKABCD234501',
        passportNumber: '*****5678',
        extraBaggageCount: 0,
        seatAssignments: [],
      },
    ]);
    const [leg] = ticket.legs;
    expect(leg.flightNumber).toBe('NA100');
    expect(leg.airline).toEqual({
      id: airlineId.toString(),
      name: 'Nile Air',
      iataCode: 'NA',
    });
    expect(leg.departure.airport.timezone).toBe('Africa/Cairo');
    expect(leg.departure.localTime).toBe('2026-12-01 14:30');
    expect(leg.departure.utc).toEqual(new Date('2026-12-01T12:30:00Z'));
    expect(leg.arrival.airport.timezone).toBe('Asia/Dubai');
    expect(leg.arrival.localTime).toBe('2026-12-01 20:30');
    expect(leg.arrival.utcOffset).toBe('GMT+04:00');
    expect(ticket.totalPrice).toBe(300);
  });

  it('never exposes the full passport number', async () => {
    const booking = makeBooking();
    const { service } = build(booking);

    const ticket = await service.getETicket(owner, booking._id.toString());

    expect(JSON.stringify(ticket)).not.toContain('A12345678');
  });

  it.each([
    BookingStatus.PENDING_PAYMENT,
    BookingStatus.EXPIRED,
    BookingStatus.CANCELLED,
    BookingStatus.HELD,
    // deliberate: the ticket is for a CONFIRMED booking (Jira SCRUM-76), not a finished trip
    BookingStatus.COMPLETED,
  ])('refuses a %s booking with 409', async (status) => {
    const booking = makeBooking({ status });
    const { service } = build(booking);

    await expect(
      service.getETicket(owner, booking._id.toString()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("treats someone else's booking exactly like a missing one", async () => {
    const booking = makeBooking();
    const { service } = build(booking);

    await expect(
      service.getETicket(
        { ...owner, userId: new Types.ObjectId().toString() },
        booking._id.toString(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is a 404 for a malformed or unknown id', async () => {
    const missing = build(null);

    await expect(
      missing.service.getETicket(owner, 'nope'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(missing.bookingModel.findById).not.toHaveBeenCalled();
    await expect(
      missing.service.getETicket(owner, new Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets an admin read any confirmed booking', async () => {
    const booking = makeBooking();
    const { service } = build(booking);

    const ticket = await service.getETicket(
      { ...owner, userId: new Types.ObjectId().toString(), role: Role.ADMIN },
      booking._id.toString(),
    );

    expect(ticket.bookingReference).toBe('ABCD2345');
  });

  describe('airline moderators', () => {
    const moderator: AuthenticatedUser = {
      userId: new Types.ObjectId().toString(),
      email: 'm@example.com',
      role: Role.AIRLINE_MODERATOR,
      jti: 'j',
      assignedProviderType: 'airline',
      assignedProviderId: airlineId.toString(),
    };

    it('may read a booking with a flight of their assigned airline', async () => {
      const booking = makeBooking();
      const { service, flightModel } = build(booking);
      flightModel.exists.mockResolvedValue({ _id: flight._id });

      const ticket = await service.getETicket(
        moderator,
        booking._id.toString(),
      );

      expect(ticket.bookingReference).toBe('ABCD2345');
      const [filter] = flightModel.exists.mock.calls[0] as unknown as [
        { airline: Types.ObjectId },
      ];
      expect(filter.airline.equals(airlineId)).toBe(true);
    });

    it('gets 404 for a booking that has no flight of their airline', async () => {
      const booking = makeBooking();
      const { service, flightModel } = build(booking);
      flightModel.exists.mockResolvedValue(null);

      await expect(
        service.getETicket(
          { ...moderator, assignedProviderId: otherAirlineId.toString() },
          booking._id.toString(),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      { assignedProviderId: undefined },
      { assignedProviderType: 'hotel' as const },
      { assignedProviderId: 'not-an-id' },
    ])('gets 404 without a valid airline assignment %j', async (override) => {
      const booking = makeBooking();
      const { service, flightModel } = build(booking);

      await expect(
        service.getETicket(
          { ...moderator, ...override },
          booking._id.toString(),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(flightModel.exists).not.toHaveBeenCalled();
    });
  });

  it('gets 404 for a hotel moderator', async () => {
    const booking = makeBooking();
    const { service } = build(booking);

    await expect(
      service.getETicket(
        {
          ...owner,
          userId: new Types.ObjectId().toString(),
          role: Role.HOTEL_MODERATOR,
        },
        booking._id.toString(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('numbers the legs of a round trip and keeps their seats', async () => {
    const booking = makeBooking({
      tripType: TripType.ROUND_TRIP,
      legs: [
        { ...makeBooking().legs[0], seatNumbers: ['12A'] },
        { ...makeBooking().legs[0], seatNumbers: ['14C'] },
      ],
    });
    const { service } = build(booking);

    const ticket = await service.getETicket(owner, booking._id.toString());

    expect(ticket.legs.map((leg) => leg.segment)).toEqual([1, 2]);
    expect(ticket.legs.map((leg) => leg.seatNumbers)).toEqual([
      ['12A'],
      ['14C'],
    ]);
    expect(ticket.tripType).toBe(TripType.ROUND_TRIP);
  });

  it('takes the duration from the booked times, not from the current flight record', async () => {
    const booking = makeBooking();
    const { service, flightModel } = build(booking);
    flightModel.find.mockReturnValue(
      query([{ ...flight, durationMinutes: 999 }]),
    );

    const ticket = await service.getETicket(owner, booking._id.toString());

    expect(ticket.legs[0].durationMinutes).toBe(240);
  });

  it('refuses a ticket for a cancelled flight', async () => {
    const booking = makeBooking();
    const { service, flightModel } = build(booking);
    flightModel.find.mockReturnValue(
      query([{ ...flight, status: 'CANCELLED' }]),
    );

    await expect(
      service.getETicket(owner, booking._id.toString()),
    ).rejects.toThrow(/cancelled/);
  });

  it("does not let an airline moderator learn about another airline's cancelled leg", async () => {
    const otherFlight = {
      ...flight,
      _id: new Types.ObjectId(),
      airline: otherAirlineId,
      flightNumber: 'OA200',
      status: 'CANCELLED',
    };
    const base = makeBooking().legs[0];
    const booking = makeBooking({
      tripType: TripType.ROUND_TRIP,
      legs: [base, { ...base, flight: otherFlight._id }],
    });
    const { service, flightModel } = build(booking);
    flightModel.find.mockReturnValue(query([flight, otherFlight]));
    flightModel.exists.mockResolvedValue({ _id: flight._id });
    const moderator: AuthenticatedUser = {
      userId: new Types.ObjectId().toString(),
      email: 'm@example.com',
      role: Role.AIRLINE_MODERATOR,
      jti: 'j',
      assignedProviderType: 'airline',
      assignedProviderId: airlineId.toString(),
    };

    // their own leg is fine: the foreign cancelled leg is invisible to them
    const ticket = await service.getETicket(moderator, booking._id.toString());
    expect(ticket.legs.map((leg) => leg.flightNumber)).toEqual(['NA100']);

    // the traveller is told, without any flight number
    await expect(
      service.getETicket(owner, booking._id.toString()),
    ).rejects.toThrow('A flight of this booking was cancelled');
    await expect(
      service.getETicket(owner, booking._id.toString()),
    ).rejects.not.toThrow(/OA200/);
  });

  it('shows an airline moderator only the legs of their airline and no price', async () => {
    const otherFlight = {
      ...flight,
      _id: new Types.ObjectId(),
      airline: otherAirlineId,
      flightNumber: 'OA200',
    };
    const base = makeBooking().legs[0];
    const booking = makeBooking({
      tripType: TripType.ROUND_TRIP,
      legs: [base, { ...base, flight: otherFlight._id }],
    });
    const { service, flightModel, airlineModel } = build(booking);
    flightModel.find.mockReturnValue(query([flight, otherFlight]));
    airlineModel.find.mockReturnValue(
      query([
        airline,
        { _id: otherAirlineId, name: 'Other Air', iataCode: 'OA' },
      ]),
    );
    flightModel.exists.mockResolvedValue({ _id: flight._id });
    const moderator: AuthenticatedUser = {
      userId: new Types.ObjectId().toString(),
      email: 'm@example.com',
      role: Role.AIRLINE_MODERATOR,
      jti: 'j',
      assignedProviderType: 'airline',
      assignedProviderId: airlineId.toString(),
    };

    const ticket = await service.getETicket(moderator, booking._id.toString());
    const full = await service.getETicket(owner, booking._id.toString());

    expect(ticket.legs.map((leg) => leg.flightNumber)).toEqual(['NA100']);
    expect(ticket.totalPrice).toBeNull();
    expect(full.legs).toHaveLength(2);
    expect(full.totalPrice).toBe(300);
  });

  it('is a 409 when a flight of the booking vanished', async () => {
    const booking = makeBooking();
    const { service, flightModel } = build(booking);
    flightModel.find.mockReturnValue(query([]));

    await expect(
      service.getETicket(owner, booking._id.toString()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('builds a PDF from the ticket', async () => {
    const booking = makeBooking();
    const { service } = build(booking);
    const ticket = await service.getETicket(owner, booking._id.toString());

    const pdf = service.toPdf(ticket).toString('latin1');

    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('ABCD2345');
    expect(pdf).toContain('ETKABCD234501');
  });
});
