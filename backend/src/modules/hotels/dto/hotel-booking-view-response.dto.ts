import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus } from '../../../common/enums';
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
