import { BookingStatus, PaymentStatus, RefundStatus } from '../../common/enums';
import { HotelBookingGroup } from './dto/list-hotel-bookings-query.dto';
import { startOfUtcDay } from './hotel-booking-dates';

const HOLDING: BookingStatus[] = [
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.HELD,
];

/**
 * The status a reservation really has right now. An unpaid hold that ran out is
 * EXPIRED even before the job flips it (GEN-11), and a CONFIRMED reservation
 * whose check-out date has passed is COMPLETED (HTL-23: "becomes Completed once
 * its check-out date has passed").
 */
export function effectiveHotelStatus(
  booking: { status: BookingStatus; holdExpiresAt?: Date; checkOutDate: Date },
  now: Date,
): BookingStatus {
  if (HOLDING.includes(booking.status)) {
    // A hold always has an end; one without (legacy data) can never be paid, so it counts as ended.
    return booking.holdExpiresAt &&
      booking.holdExpiresAt.getTime() > now.getTime()
      ? BookingStatus.PENDING_PAYMENT
      : BookingStatus.EXPIRED;
  }
  if (
    booking.status === BookingStatus.CONFIRMED &&
    booking.checkOutDate.getTime() < startOfUtcDay(now).getTime()
  ) {
    return BookingStatus.COMPLETED;
  }
  return booking.status;
}

export function groupOfStatus(status: BookingStatus): HotelBookingGroup {
  if (status === BookingStatus.CANCELLED) return HotelBookingGroup.CANCELLED;
  if (status === BookingStatus.COMPLETED || status === BookingStatus.EXPIRED) {
    return HotelBookingGroup.PAST;
  }
  return HotelBookingGroup.UPCOMING;
}

export const GROUP_STATUSES: Record<HotelBookingGroup, BookingStatus[]> = {
  [HotelBookingGroup.UPCOMING]: [
    BookingStatus.PENDING_PAYMENT,
    BookingStatus.CONFIRMED,
  ],
  [HotelBookingGroup.PAST]: [BookingStatus.COMPLETED, BookingStatus.EXPIRED],
  [HotelBookingGroup.CANCELLED]: [BookingStatus.CANCELLED],
};

/** The statuses a list shows: the group, the explicit statuses, or both (the intersection); all when neither is given. */
export function statusesToList(
  group: HotelBookingGroup | undefined,
  statuses: BookingStatus[] | undefined,
): BookingStatus[] {
  const all = Object.values(GROUP_STATUSES).flat();
  const byGroup = group ? GROUP_STATUSES[group] : all;
  return statuses ? byGroup.filter((s) => statuses.includes(s)) : byGroup;
}

/** The Mongo condition of one effective status (the same rules as effectiveHotelStatus). */
export function statusCondition(
  status: BookingStatus,
  now: Date,
): Record<string, unknown> {
  const today = startOfUtcDay(now);
  switch (status) {
    case BookingStatus.PENDING_PAYMENT:
      return { status: { $in: HOLDING }, holdExpiresAt: { $gt: now } };
    case BookingStatus.EXPIRED:
      return {
        $or: [
          { status: BookingStatus.EXPIRED },
          {
            status: { $in: HOLDING },
            $or: [{ holdExpiresAt: { $lte: now } }, { holdExpiresAt: null }],
          },
        ],
      };
    case BookingStatus.CONFIRMED:
      return { status: BookingStatus.CONFIRMED, checkOutDate: { $gte: today } };
    case BookingStatus.COMPLETED:
      return {
        $or: [
          { status: BookingStatus.COMPLETED },
          { status: BookingStatus.CONFIRMED, checkOutDate: { $lt: today } },
        ],
      };
    default:
      return { status };
  }
}

export interface HotelBookingListRoom {
  roomId: string;
  roomName: string;
  guestCount: number;
  subtotal: number;
}

export interface HotelBookingListItem {
  id: string;
  bookingReference: string;
  status: BookingStatus;
  group: HotelBookingGroup;
  hotelId: string;
  hotelName: string | null;
  checkInDate: Date;
  checkOutDate: Date;
  nights: number;
  rooms: HotelBookingListRoom[];
  guestCount: number;
  totalPrice: number;
  currency: string;
  holdExpiresAt: Date | null;
  createdAt: Date;
}

export interface HotelBookingListResponse {
  data: HotelBookingListItem[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface HotelDetailsRoom {
  roomId: string;
  roomName: string;
  adults: number;
  childrenAges: number[];
  guestCount: number;
  nights: number;
  averagePricePerNight: number | null;
  subtotal: number | null;
}

export interface HotelDetailsPayment {
  id: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  paidAt: Date | null;
}

export interface HotelDetailsRefund {
  id: string;
  status: RefundStatus;
  amount: number;
  currency: string;
  reason: string | null;
  policyCalculationNotes: string | null;
  processedAt: Date | null;
}

export interface HotelBookingDetails {
  id: string;
  bookingReference: string;
  status: BookingStatus;
  group: HotelBookingGroup;
  hotelId: string;
  hotelName: string | null;
  checkInDate: Date;
  checkOutDate: Date;
  nights: number;
  holdExpiresAt: Date | null;
  rooms: HotelDetailsRoom[];
  guestCount: number;
  primaryGuestName: string;
  primaryGuestEmail: string | null;
  primaryGuestPhone: string | null;
  specialRequests: string | null;
  totalPrice: number | null;
  currency: string;
  policies: Record<string, unknown> | null;
  policyAcceptedAt: Date | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  refundAmount: number | null;
  payment: HotelDetailsPayment | null;
  refund: HotelDetailsRefund | null;
  createdAt: Date;
  updatedAt: Date;
}
