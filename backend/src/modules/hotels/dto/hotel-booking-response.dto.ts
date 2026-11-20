import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus } from '../../../common/enums';

/** Swagger-only shapes: they document what HotelBookingsService returns. */

export class HotelReservedRoomDto {
  @ApiProperty() roomId: string;
  @ApiProperty() roomName: string;
  @ApiProperty() adults: number;
  @ApiProperty({ type: [Number] }) childrenAges: number[];
  @ApiProperty() guestCount: number;
  @ApiProperty() nights: number;
  @ApiProperty({
    description: 'Average over the nights (prices can differ per night)',
  })
  averagePricePerNight: number;
  @ApiProperty({
    description: "Sum of the nights x this room's price at booking time",
  })
  subtotal: number;
}

export class HotelBookingResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() bookingReference: string;
  @ApiProperty({ enum: BookingStatus, example: BookingStatus.PENDING_PAYMENT })
  status: BookingStatus;
  @ApiProperty() hotelId: string;
  @ApiProperty() hotelName: string;
  @ApiProperty({ type: Date, description: 'UTC midnight of the check-in date' })
  checkInDate: Date;
  @ApiProperty({
    type: Date,
    description: 'UTC midnight of the check-out date',
  })
  checkOutDate: Date;
  @ApiProperty() nights: number;
  @ApiProperty({
    nullable: true,
    type: Date,
    description: 'When the 10-minute hold ends (never extended)',
  })
  holdExpiresAt: Date | null;
  @ApiProperty({ type: [HotelReservedRoomDto] }) rooms: HotelReservedRoomDto[];
  @ApiProperty() guestCount: number;
  @ApiProperty() primaryGuestName: string;
  @ApiProperty() primaryGuestEmail: string;
  @ApiProperty({ nullable: true, type: String }) primaryGuestPhone:
    string | null;
  @ApiProperty({ nullable: true, type: String }) specialRequests: string | null;
  @ApiProperty({
    description: 'Sum over the rooms of the nights x the room price',
  })
  totalPrice: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Hotel policies copied at booking time: check-in/check-out times and cancellation tiers (days before check-in -> refund %). Accept them with POST /bookings/hotel/:id/accept-policies before paying.',
  })
  policies: Record<string, unknown>;
  @ApiProperty({ type: Date }) createdAt: Date;
}
