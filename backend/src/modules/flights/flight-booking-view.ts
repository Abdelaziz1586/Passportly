import {
  BookingStatus,
  CabinClass,
  FlightStatus,
  PassengerType,
  PaymentStatus,
  RefundStatus,
  TripType,
} from '../../common/enums';
import { maskPassport } from './flight-booking-details';

export interface BookingViewAirport {
  iataCode: string;
  name: string;
  /** IANA time zone of the airport. */
  timezone: string;
}

export interface BookingViewLeg {
  segment: number;
  flightId: string;
  /** null if the flight record no longer exists. */
  flightNumber: string | null;
  airline: { id: string; name: string; iataCode: string } | null;
  flightStatus: FlightStatus | null;
  departureAirport: BookingViewAirport | null;
  arrivalAirport: BookingViewAirport | null;
  cabinClass: CabinClass;
  departureTime: Date;
  arrivalTime: Date;
  unitPrice: number | null;
  seatNumbers: string[];
}

export interface BookingViewPassenger {
  id: string | null;
  firstName: string;
  lastName: string;
  type: PassengerType;
  dateOfBirth: Date | null;
  gender: string | null;
  /** Masked: only the last 4 characters. */
  passportNumber: string;
  passportExpiry: Date | null;
  nationality: string | null;
  extraBaggageCount: number;
  extraBaggageFee: number | null;
  eTicketNumber: string | null;
  seatAssignments: string[];
}

export interface BookingViewPayment {
  id: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  paidAt: Date | null;
}

export interface BookingViewRefund {
  id: string;
  status: RefundStatus;
  amount: number;
  currency: string;
  reason: string | null;
  policyCalculationNotes: string | null;
  processedAt: Date | null;
}

export interface FlightBookingDetails {
  id: string;
  bookingReference: string;
  status: BookingStatus;
  tripType: TripType;
  holdExpiresAt: Date | null;
  passengerCounts: {
    adults: number;
    children: number;
    infants: number;
    totalSeatsRequired: number;
  };
  passengers: BookingViewPassenger[];
  legs: BookingViewLeg[];
  baseFareTotal: number | null;
  extraBaggageTotal: number | null;
  taxesAndFees: number | null;
  totalPrice: number | null;
  currency: string;
  policies: Record<string, unknown> | null;
  policyAcceptedAt: Date | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  refundAmount: number | null;
  payment: BookingViewPayment | null;
  /** The refund of this booking (PAY-03), if one was issued. */
  refund: BookingViewRefund | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A hold that ran out but is not expired by the job yet is never reported as pending. */
export function effectiveStatus(
  status: BookingStatus,
  holdExpiresAt: Date | undefined,
  now: Date,
): BookingStatus {
  const holding =
    status === BookingStatus.PENDING_PAYMENT || status === BookingStatus.HELD;
  return holding && holdExpiresAt && holdExpiresAt.getTime() <= now.getTime()
    ? BookingStatus.EXPIRED
    : status;
}

export function toViewPassenger(
  passenger: {
    _id?: { toString(): string };
    firstName: string;
    lastName: string;
    type: PassengerType;
    dateOfBirth?: Date;
    gender?: string;
    passportNumber?: string;
    passportExpiry?: Date;
    nationality?: string;
    extraBaggageCount: number;
    extraBaggageFee: number;
    eTicketNumber?: string;
    seatAssignments?: string[];
  },
  moderatorView: boolean,
): BookingViewPassenger {
  return {
    id: passenger._id ? passenger._id.toString() : null,
    firstName: passenger.firstName,
    lastName: passenger.lastName,
    type: passenger.type,
    // An airline moderator needs the manifest, not the traveller's personal details or fees.
    dateOfBirth: moderatorView ? null : (passenger.dateOfBirth ?? null),
    gender: moderatorView ? null : (passenger.gender ?? null),
    passportNumber: maskPassport(passenger.passportNumber),
    passportExpiry: moderatorView ? null : (passenger.passportExpiry ?? null),
    nationality: moderatorView ? null : (passenger.nationality ?? null),
    extraBaggageCount: passenger.extraBaggageCount,
    extraBaggageFee: moderatorView ? null : passenger.extraBaggageFee,
    eTicketNumber: passenger.eTicketNumber ?? null,
    // Seats of all legs: a moderator gets the seats of their own legs from `legs[].seatNumbers`.
    seatAssignments: moderatorView
      ? []
      : [...(passenger.seatAssignments ?? [])],
  };
}
