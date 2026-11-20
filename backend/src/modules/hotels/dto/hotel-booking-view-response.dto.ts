import { ApiProperty } from '@nestjs/swagger';
import {
  BookingStatus,
  PaymentStatus,
  RefundStatus,
} from '../../../common/enums';
import {
  HotelBookingGroup,
  LISTABLE_HOTEL_STATUSES,
} from './list-hotel-bookings-query.dto';

/** Swagger-only shapes: they document what HotelBookingViewService returns. */

export class HotelListRoomDto {
  @ApiProperty() roomId: string;
  @ApiProperty() roomName: string;
  @ApiProperty() guestCount: number;
  @ApiProperty() subtotal: number;
}

export class HotelBookingListItemDto {
  @ApiProperty() id: string;
  @ApiProperty() bookingReference: string;
  @ApiProperty({
    enum: LISTABLE_HOTEL_STATUSES,
    description:
      'As it is now: a hold that ran out is EXPIRED, a confirmed stay whose check-out date passed is COMPLETED',
  })
  status: BookingStatus;
  @ApiProperty({ enum: HotelBookingGroup }) group: HotelBookingGroup;
  @ApiProperty() hotelId: string;
  @ApiProperty({ nullable: true, type: String }) hotelName: string | null;
  @ApiProperty({ type: Date, description: 'UTC midnight' }) checkInDate: Date;
  @ApiProperty({ type: Date, description: 'UTC midnight' }) checkOutDate: Date;
  @ApiProperty() nights: number;
  @ApiProperty({ type: [HotelListRoomDto] }) rooms: HotelListRoomDto[];
  @ApiProperty() guestCount: number;
  @ApiProperty() totalPrice: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({
    nullable: true,
    type: Date,
    description: 'When the 10-minute hold ends',
  })
  holdExpiresAt: Date | null;
  @ApiProperty({ type: Date }) createdAt: Date;
}

export class HotelBookingListMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({
    example: 42,
    description: 'All reservations matching the filter',
  })
  total: number;
  @ApiProperty({ example: 5, description: '0 when there are no matches' })
  totalPages: number;
}

export class HotelBookingListResponseDto {
  @ApiProperty({ type: [HotelBookingListItemDto] })
  data: HotelBookingListItemDto[];
  @ApiProperty({ type: HotelBookingListMetaDto }) meta: HotelBookingListMetaDto;
}

export class HotelDetailsRoomDto {
  @ApiProperty() roomId: string;
  @ApiProperty() roomName: string;
  @ApiProperty() adults: number;
  @ApiProperty({ type: [Number] }) childrenAges: number[];
  @ApiProperty() guestCount: number;
  @ApiProperty() nights: number;
  @ApiProperty({ nullable: true, type: Number }) averagePricePerNight:
    number | null;
  @ApiProperty({ nullable: true, type: Number }) subtotal: number | null;
}

export class HotelDetailsPaymentDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: PaymentStatus }) status: PaymentStatus;
  @ApiProperty({ description: 'Major units, e.g. 123.45' }) amount: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({ nullable: true, type: Date }) paidAt: Date | null;
}

export class HotelDetailsRefundDto {
  @ApiProperty() id: string;
  @ApiProperty({
    enum: RefundStatus,
    description: 'PENDING (being processed), SUCCEEDED (refunded) or FAILED',
  })
  status: RefundStatus;
  @ApiProperty() amount: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'How the amount was computed from the tiers stored on the reservation',
  })
  policyCalculationNotes: string | null;
  @ApiProperty({ nullable: true, type: Date }) processedAt: Date | null;
}

export class HotelBookingDetailsResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() bookingReference: string;
  @ApiProperty({ enum: LISTABLE_HOTEL_STATUSES }) status: BookingStatus;
  @ApiProperty({ enum: HotelBookingGroup }) group: HotelBookingGroup;
  @ApiProperty() hotelId: string;
  @ApiProperty({ nullable: true, type: String }) hotelName: string | null;
  @ApiProperty({ type: Date }) checkInDate: Date;
  @ApiProperty({ type: Date }) checkOutDate: Date;
  @ApiProperty() nights: number;
  @ApiProperty({ nullable: true, type: Date }) holdExpiresAt: Date | null;
  @ApiProperty({ type: [HotelDetailsRoomDto] }) rooms: HotelDetailsRoomDto[];
  @ApiProperty() guestCount: number;
  @ApiProperty() primaryGuestName: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'null for a hotel moderator',
  })
  primaryGuestEmail: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'null for a hotel moderator',
  })
  primaryGuestPhone: string | null;
  @ApiProperty({ nullable: true, type: String }) specialRequests: string | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'null for a hotel moderator',
  })
  totalPrice: number | null;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'Hotel policies copied at booking time: check-in/check-out times and cancellation tiers',
  })
  policies: Record<string, unknown> | null;
  @ApiProperty({ nullable: true, type: Date }) policyAcceptedAt: Date | null;
  @ApiProperty({ nullable: true, type: Date }) confirmedAt: Date | null;
  @ApiProperty({ nullable: true, type: Date }) cancelledAt: Date | null;
  @ApiProperty({ nullable: true, type: String }) cancellationReason:
    string | null;
  @ApiProperty({ nullable: true, type: Number }) refundAmount: number | null;
  @ApiProperty({ type: HotelDetailsPaymentDto, nullable: true })
  payment: HotelDetailsPaymentDto | null;
  @ApiProperty({
    type: HotelDetailsRefundDto,
    nullable: true,
    description:
      'The refund of this reservation with its status; null if none was issued',
  })
  refund: HotelDetailsRefundDto | null;
  @ApiProperty({ type: Date }) createdAt: Date;
  @ApiProperty({ type: Date }) updatedAt: Date;
}
