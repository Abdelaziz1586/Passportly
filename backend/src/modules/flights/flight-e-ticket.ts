import {
  BookingStatus,
  CabinClass,
  PassengerType,
  TripType,
} from '../../common/enums';
import { maskPassport } from './flight-booking-details';
import { PdfLine } from './simple-pdf';

export interface ETicketAirport {
  iataCode: string;
  name: string;
  city: string | null;
  /** IANA time zone of the airport (from Airports.csv). */
  timezone: string;
}

export interface ETicketEndpoint {
  airport: ETicketAirport;
  /** The instant, in UTC. */
  utc: Date;
  /** The same instant in the airport's own time zone, e.g. "2026-12-01 14:30". */
  localTime: string;
  /** Offset of the airport's time zone at that instant, e.g. "GMT+02:00". */
  utcOffset: string;
}

export interface ETicketLeg {
  segment: number;
  flightId: string;
  flightNumber: string;
  airline: { id: string; name: string; iataCode: string };
  cabinClass: CabinClass;
  durationMinutes: number;
  departure: ETicketEndpoint;
  arrival: ETicketEndpoint;
  seatNumbers: string[];
}

export interface ETicketPassenger {
  firstName: string;
  lastName: string;
  type: PassengerType;
  eTicketNumber: string | null;
  /** Masked: only the last 4 characters. */
  passportNumber: string;
  extraBaggageCount: number;
  seatAssignments: string[];
}

export interface ETicket {
  bookingId: string;
  /** The booking reference (PNR). */
  bookingReference: string;
  status: BookingStatus;
  tripType: TripType;
  issuedAt: Date | null;
  passengers: ETicketPassenger[];
  legs: ETicketLeg[];
  totalPrice: number;
  currency: string;
}

const FALLBACK_TIME_ZONE = 'UTC';

/** Validates an IANA zone; an unknown one falls back to UTC instead of failing the whole ticket. */
function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

/** "YYYY-MM-DD HH:mm" of the instant in the given IANA time zone (GEN-06: airport local time). */
export function formatLocalTime(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/** "GMT+02:00" style offset of the zone at the instant. */
export function formatUtcOffset(instant: Date, timeZone: string): string {
  const zone = safeZone(timeZone);
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;
  return name === 'GMT' || !name ? 'GMT+00:00' : name;
}

export function toEndpoint(
  airport: ETicketAirport,
  utc: Date,
): ETicketEndpoint {
  return {
    airport,
    utc,
    localTime: formatLocalTime(utc, airport.timezone),
    utcOffset: formatUtcOffset(utc, airport.timezone),
  };
}

export function toETicketPassenger(passenger: {
  firstName: string;
  lastName: string;
  type: PassengerType;
  eTicketNumber?: string;
  passportNumber?: string;
  extraBaggageCount: number;
  seatAssignments?: string[];
}): ETicketPassenger {
  return {
    firstName: passenger.firstName,
    lastName: passenger.lastName,
    type: passenger.type,
    eTicketNumber: passenger.eTicketNumber ?? null,
    passportNumber: maskPassport(passenger.passportNumber),
    extraBaggageCount: passenger.extraBaggageCount,
    seatAssignments: [...(passenger.seatAssignments ?? [])],
  };
}

/** The lines of the downloadable PDF e-ticket (the same data as the JSON payload). */
export function eTicketToPdfLines(ticket: ETicket): PdfLine[] {
  const lines: PdfLine[] = [
    { text: 'Passportly E-Ticket', size: 20, bold: true },
    { text: ' ' },
    {
      text: `Booking reference (PNR): ${ticket.bookingReference}`,
      size: 14,
      bold: true,
    },
    {
      text: `Status: ${ticket.status}    Trip: ${ticket.tripType === TripType.ROUND_TRIP ? 'Round trip' : 'One way'}`,
    },
    {
      text: `Total paid: ${ticket.totalPrice.toFixed(2)} ${ticket.currency}${ticket.issuedAt ? `    Issued: ${ticket.issuedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}`,
    },
    { text: ' ' },
    { text: 'Flights', size: 14, bold: true },
  ];
  for (const leg of ticket.legs) {
    lines.push(
      {
        text: `${leg.segment}. ${leg.airline.name} ${leg.flightNumber} - ${leg.cabinClass.replace('_', ' ')}`,
        bold: true,
      },
      {
        text: `   Departs ${leg.departure.airport.iataCode} (${leg.departure.airport.name}) ${leg.departure.localTime} ${leg.departure.utcOffset} local`,
      },
      {
        text: `   Arrives ${leg.arrival.airport.iataCode} (${leg.arrival.airport.name}) ${leg.arrival.localTime} ${leg.arrival.utcOffset} local`,
      },
    );
    if (leg.seatNumbers.length > 0) {
      lines.push({ text: `   Seats: ${leg.seatNumbers.join(', ')}` });
    }
  }
  lines.push({ text: ' ' }, { text: 'Passengers', size: 14, bold: true });
  ticket.passengers.forEach((passenger, index) => {
    lines.push(
      {
        text: `${index + 1}. ${passenger.firstName} ${passenger.lastName} (${passenger.type})`,
        bold: true,
      },
      {
        text: `   E-ticket number: ${passenger.eTicketNumber ?? '-'}    Passport: ${passenger.passportNumber}`,
      },
      {
        text: `   Extra bags: ${passenger.extraBaggageCount}${passenger.seatAssignments.length > 0 ? `    Seats: ${passenger.seatAssignments.join(', ')}` : ''}`,
      },
    );
  });
  lines.push(
    { text: ' ' },
    {
      text: "Times are shown in each airport's local time. Bring a valid passport or ID.",
      size: 9,
    },
  );
  return lines;
}
