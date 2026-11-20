import { Types } from 'mongoose';
import {
  BookingStatus,
  CabinClass,
  PassengerType,
  Role,
  TripType,
} from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { eTicketToPdfLines } from './flight-e-ticket';
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
const airlineA = new Types.ObjectId();
const airlineB = new Types.ObjectId();
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
const flightA = {
  _id: new Types.ObjectId(),
  status: 'SCHEDULED',
  airline: airlineA,
  flightNumber: 'NA100',
  departureAirport: cairo._id,
  arrivalAirport: dubai._id,
  durationMinutes: 240,
};
const flightB = {
  _id: new Types.ObjectId(),
  status: 'SCHEDULED',
  airline: airlineB,
  flightNumber: 'OA200',
  departureAirport: dubai._id,
  arrivalAirport: cairo._id,
  durationMinutes: 240,
};

const leg = (flight: typeof flightA, seat: string) => ({
  flight: flight._id,
  cabinClass: CabinClass.ECONOMY,
  departureTime: new Date('2026-12-01T12:30:00Z'),
  arrivalTime: new Date('2026-12-01T16:30:00Z'),
  seatNumbers: [seat],
});

// A confirmed round trip on two airlines; the passenger chose 12A on the first leg and 14C on the return.
const booking = {
  _id: new Types.ObjectId(),
  user: ownerId,
  bookingReference: 'ABCD2345',
  status: BookingStatus.CONFIRMED,
  tripType: TripType.ROUND_TRIP,
  confirmedAt: new Date('2026-11-19T10:00:00Z'),
  legs: [leg(flightA, '12A'), leg(flightB, '14C')],
  passengers: [
    {
      firstName: 'Layla',
      lastName: 'Hassan',
      type: PassengerType.ADULT,
      eTicketNumber: 'ETKABCD234501',
      passportNumber: 'A12345678',
      extraBaggageCount: 0,
      seatAssignments: ['12A', '14C'],
    },
  ],
  totalPrice: 600,
  currency: 'USD',
};

function build() {
  const service = new FlightETicketService(
    { findById: jest.fn(() => query(booking)) } as never,
    {
      find: jest.fn(() => query([flightA, flightB])),
      exists: jest.fn().mockResolvedValue({ _id: flightA._id }),
    } as never,
    {
      find: jest.fn(() =>
        query([
          { _id: airlineA, name: 'Nile Air', iataCode: 'NA' },
          { _id: airlineB, name: 'Other Air', iataCode: 'OA' },
        ]),
      ),
    } as never,
    { find: jest.fn(() => query([cairo, dubai])) } as never,
  );
  return service;
}

const owner: AuthenticatedUser = {
  userId: ownerId.toString(),
  email: 'o@example.com',
  role: Role.REGISTERED_USER,
  jti: 'j',
};
const admin: AuthenticatedUser = {
  userId: new Types.ObjectId().toString(),
  email: 'a@example.com',
  role: Role.ADMIN,
  jti: 'j',
};
const moderator: AuthenticatedUser = {
  userId: new Types.ObjectId().toString(),
  email: 'm@example.com',
  role: Role.AIRLINE_MODERATOR,
  jti: 'j',
  assignedProviderType: 'airline',
  assignedProviderId: airlineA.toString(),
};

describe('e-ticket seats for an airline moderator', () => {
  it('gives the moderator no seats for any leg, in the passengers or in the legs (JSON)', async () => {
    const ticket = await build().getETicket(moderator, booking._id.toString());
    // only their own airline's leg is visible, and it carries no seat
    expect(ticket.legs.map((l) => l.flightNumber)).toEqual(['NA100']);
    expect(ticket.legs[0].seatNumbers).toEqual([]);
    expect(ticket.passengers[0].seatAssignments).toEqual([]);
    const json = JSON.stringify(ticket);
    expect(json).not.toContain('12A');
    expect(json).not.toContain('14C');
  });

  it('keeps the other airline’s seat out of the PDF lines too', async () => {
    const service = build();
    const ticket = await service.getETicket(moderator, booking._id.toString());
    const text = eTicketToPdfLines(ticket)
      .map((line) => line.text)
      .join('\n');
    expect(text).not.toContain('14C');
    expect(text).not.toContain('12A');
    expect(text).not.toMatch(/Seats:/);
  });

  it('still shows the owner and an admin every seat', async () => {
    const service = build();
    const mine = await service.getETicket(owner, booking._id.toString());
    expect(mine.passengers[0].seatAssignments).toEqual(['12A', '14C']);
    expect(mine.legs.map((l) => l.seatNumbers)).toEqual([['12A'], ['14C']]);
    const all = await service.getETicket(admin, booking._id.toString());
    expect(all.passengers[0].seatAssignments).toEqual(['12A', '14C']);
  });

  it('does not change the stored booking (the moderator view is a copy)', async () => {
    await build().getETicket(moderator, booking._id.toString());
    expect(booking.passengers[0].seatAssignments).toEqual(['12A', '14C']);
    expect(booking.legs[0].seatNumbers).toEqual(['12A']);
  });
});
