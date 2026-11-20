import { ApiProperty } from '@nestjs/swagger';
import {
  BookingStatus,
  CabinClass,
  PassengerType,
  TripType,
} from '../../../common/enums';

/** Swagger-only shapes: they document what FlightBookingsService.listBookings returns. */

export class FlightBookingLegDto {
  @ApiProperty() flightId: string;
  @ApiProperty({ enum: CabinClass }) cabinClass: CabinClass;
  @ApiProperty({ description: 'UTC' }) departureTime: Date;
  @ApiProperty({ description: 'UTC' }) arrivalTime: Date;
  @ApiProperty() unitPrice: number;
}

export class FlightBookingPassengerCountsDto {
  @ApiProperty() adults: number;
  @ApiProperty() children: number;
  @ApiProperty() infants: number;
  @ApiProperty() totalSeatsRequired: number;
}

export class FlightBookingPassengerDto {
  @ApiProperty({ nullable: true, type: String }) id: string | null;
  @ApiProperty() firstName: string;
  @ApiProperty() lastName: string;
  @ApiProperty({ enum: PassengerType }) type: PassengerType;
  @ApiProperty({ nullable: true, type: Date }) dateOfBirth: Date | null;
  @ApiProperty({ nullable: true, type: String }) gender: string | null;
  @ApiProperty({ description: 'Masked: only the last 4 characters' })
  passportNumber: string;
  @ApiProperty({ nullable: true, type: Date }) passportExpiry: Date | null;
  @ApiProperty({ nullable: true, type: String }) nationality: string | null;
  @ApiProperty() extraBaggageCount: number;
  @ApiProperty() extraBaggageFee: number;
}

export class FlightBookingListItemDto {
  @ApiProperty() id: string;
  @ApiProperty() bookingReference: string;
  @ApiProperty({ enum: BookingStatus }) status: BookingStatus;
  @ApiProperty({ enum: TripType }) tripType: TripType;
  @ApiProperty({ description: 'When the 10-minute seat hold ends' })
  holdExpiresAt: Date;
  @ApiProperty({ type: FlightBookingPassengerCountsDto })
  passengerCounts: FlightBookingPassengerCountsDto;
  @ApiProperty({ type: [FlightBookingPassengerDto] })
  passengers: FlightBookingPassengerDto[];
  @ApiProperty({ type: [FlightBookingLegDto] }) legs: FlightBookingLegDto[];
  @ApiProperty() baseFareTotal: number;
  @ApiProperty() extraBaggageTotal: number;
  @ApiProperty() taxesAndFees: number;
  @ApiProperty() totalPrice: number;
  @ApiProperty() currency: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'Baggage and cancellation policies captured with the passenger details; null until they are submitted',
  })
  policies: Record<string, unknown> | null;
  @ApiProperty() createdAt: Date;
}

export class FlightBookingListMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 42, description: 'All bookings matching the filter' })
  total: number;
  @ApiProperty({ example: 5, description: '0 when there are no matches' })
  totalPages: number;
}

export class FlightBookingListResponseDto {
  @ApiProperty({ type: [FlightBookingListItemDto] })
  data: FlightBookingListItemDto[];
  @ApiProperty({ type: FlightBookingListMetaDto })
  meta: FlightBookingListMetaDto;
}
