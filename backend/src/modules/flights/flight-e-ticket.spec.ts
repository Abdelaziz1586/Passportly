import {
  BookingStatus,
  CabinClass,
  PassengerType,
  TripType,
} from '../../common/enums';
import {
  ETicket,
  eTicketToPdfLines,
  formatLocalTime,
  formatUtcOffset,
  toEndpoint,
  toETicketPassenger,
} from './flight-e-ticket';

describe('airport local time (GEN-06)', () => {
  const instant = new Date('2026-12-01T12:30:00.000Z');

  it.each([
    ['Africa/Cairo', '2026-12-01 14:30', 'GMT+02:00'],
    ['Asia/Dubai', '2026-12-01 16:30', 'GMT+04:00'],
    ['America/New_York', '2026-12-01 07:30', 'GMT-05:00'],
    ['UTC', '2026-12-01 12:30', 'GMT+00:00'],
  ])('%s', (zone, local, offset) => {
    expect(formatLocalTime(instant, zone)).toBe(local);
    expect(formatUtcOffset(instant, zone)).toBe(offset);
  });

  it('follows daylight saving time of the instant', () => {
    expect(
      formatUtcOffset(new Date('2026-07-01T12:00:00Z'), 'Europe/London'),
    ).toBe('GMT+01:00');
    expect(
      formatUtcOffset(new Date('2026-12-01T12:00:00Z'), 'Europe/London'),
    ).toBe('GMT+00:00');
  });

  it('can land on the next day locally', () => {
    expect(
      formatLocalTime(new Date('2026-12-01T22:30:00Z'), 'Asia/Dubai'),
    ).toBe('2026-12-02 02:30');
  });

  it('falls back to UTC for an unknown zone instead of failing', () => {
    expect(formatLocalTime(instant, 'Mars/Olympus')).toBe('2026-12-01 12:30');
    expect(formatUtcOffset(instant, 'Mars/Olympus')).toBe('GMT+00:00');
  });

  it('builds an endpoint with the UTC instant, local time and offset', () => {
    const endpoint = toEndpoint(
      {
        iataCode: 'CAI',
        name: 'Cairo Intl',
        city: 'Cairo',
        timezone: 'Africa/Cairo',
      },
      instant,
    );

    expect(endpoint).toEqual({
      airport: {
        iataCode: 'CAI',
        name: 'Cairo Intl',
        city: 'Cairo',
        timezone: 'Africa/Cairo',
      },
      utc: instant,
      localTime: '2026-12-01 14:30',
      utcOffset: 'GMT+02:00',
    });
  });
});

describe('toETicketPassenger', () => {
  it('masks the passport and keeps the e-ticket number', () => {
    expect(
      toETicketPassenger({
        firstName: 'Layla',
        lastName: 'Hassan',
        type: PassengerType.ADULT,
        eTicketNumber: 'ETKABCD234501',
        passportNumber: 'A12345678',
        extraBaggageCount: 1,
        seatAssignments: ['12A'],
      }),
    ).toEqual({
      firstName: 'Layla',
      lastName: 'Hassan',
      type: PassengerType.ADULT,
      eTicketNumber: 'ETKABCD234501',
      passportNumber: '*****5678',
      extraBaggageCount: 1,
      seatAssignments: ['12A'],
    });
  });

  it('copes with a missing e-ticket number, passport and seats', () => {
    const passenger = toETicketPassenger({
      firstName: 'A',
      lastName: 'B',
      type: PassengerType.INFANT,
      extraBaggageCount: 0,
    });

    expect(passenger.eTicketNumber).toBeNull();
    expect(passenger.passportNumber).toBe('');
    expect(passenger.seatAssignments).toEqual([]);
  });
});

describe('eTicketToPdfLines', () => {
  const ticket: ETicket = {
    bookingId: 'b1',
    bookingReference: 'ABCD2345',
    status: BookingStatus.CONFIRMED,
    tripType: TripType.ROUND_TRIP,
    issuedAt: new Date('2026-11-19T10:00:00Z'),
    passengers: [
      {
        firstName: 'Layla',
        lastName: 'Hassan',
        type: PassengerType.ADULT,
        eTicketNumber: 'ETKABCD234501',
        passportNumber: '*****5678',
        extraBaggageCount: 1,
        seatAssignments: [],
      },
    ],
    legs: [
      {
        segment: 1,
        flightId: 'f1',
        flightNumber: 'NA100',
        airline: { id: 'a1', name: 'Nile Air', iataCode: 'NA' },
        cabinClass: CabinClass.PREMIUM_ECONOMY,
        durationMinutes: 240,
        departure: toEndpoint(
          {
            iataCode: 'CAI',
            name: 'Cairo Intl',
            city: null,
            timezone: 'Africa/Cairo',
          },
          new Date('2026-12-01T12:30:00Z'),
        ),
        arrival: toEndpoint(
          {
            iataCode: 'DXB',
            name: 'Dubai Intl',
            city: null,
            timezone: 'Asia/Dubai',
          },
          new Date('2026-12-01T16:30:00Z'),
        ),
        seatNumbers: ['12A'],
      },
    ],
    totalPrice: 340.5,
    currency: 'USD',
  };

  it('contains the reference, flight, local times, passenger and ticket number', () => {
    const text = eTicketToPdfLines(ticket)
      .map((line) => line.text)
      .join('\n');

    expect(text).toContain('Booking reference (PNR): ABCD2345');
    expect(text).toContain('Round trip');
    expect(text).toContain('Total paid: 340.50 USD');
    expect(text).toContain('Nile Air NA100 - PREMIUM ECONOMY');
    expect(text).toContain(
      'Departs CAI (Cairo Intl) 2026-12-01 14:30 GMT+02:00 local',
    );
    expect(text).toContain(
      'Arrives DXB (Dubai Intl) 2026-12-01 20:30 GMT+04:00 local',
    );
    expect(text).toContain('Seats: 12A');
    expect(text).toContain('Layla Hassan (ADULT)');
    expect(
      eTicketToPdfLines({ ...ticket, totalPrice: null })
        .map((line) => line.text)
        .join('\n'),
    ).not.toContain('Total paid');
    expect(text).toContain('E-ticket number: ETKABCD234501');
    expect(text).toContain('Passport: *****5678');
  });
});
