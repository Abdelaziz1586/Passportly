import { ApiProperty } from '@nestjs/swagger';
import {
  BookingStatus,
  CabinClass,
  PassengerType,
  PaymentStatus,
  TripType,
} from '../../../common/enums';
import { FlightBookingPassengerCountsDto } from './flight-booking-list-response.dto';

/** Swagger-only shapes: they document what FlightBookingViewService returns. */

export class BookingDetailsLegDto {
  @ApiProperty() segment: number;
  @ApiProperty() flightId: string;
  @ApiProperty() flightNumber: string;
  @ApiProperty({
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      iataCode: { type: 'string' },
    },
  })
  airline: { id: string; name: string; iataCode: string };
  @ApiProperty({ enum: CabinClass }) cabinClass: CabinClass;
  @ApiProperty({ type: Date, description: 'UTC' }) departureTime: Date;
  @ApiProperty({ type: Date, description: 'UTC' }) arrivalTime: Date;
  @ApiProperty({ nullable: true, type: Number }) unitPrice: number | null;
  @ApiProperty({ type: [String] }) seatNumbers: string[];
}

export class BookingDetailsPassengerDto {
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
  @ApiProperty({ nullable: true, type: Number }) extraBaggageFee: number | null;
  @ApiProperty({ nullable: true, type: String }) eTicketNumber: string | null;
  @ApiProperty({ type: [String] }) seatAssignments: string[];
}

export class BookingDetailsPaymentDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: PaymentStatus }) status: PaymentStatus;
  @ApiProperty({ description: 'Major units, e.g. 123.45' }) amount: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({ nullable: true, type: Date }) paidAt: Date | null;
}

export class FlightBookingDetailsResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() bookingReference: string;
  @ApiProperty({
    enum: BookingStatus,
    description: 'A hold that ran out is reported as EXPIRED',
  })
  status: BookingStatus;
  @ApiProperty({ enum: TripType }) tripType: TripType;
  @ApiProperty({ nullable: true, type: Date }) holdExpiresAt: Date | null;
  @ApiProperty({ type: FlightBookingPassengerCountsDto })
  passengerCounts: FlightBookingPassengerCountsDto;
  @ApiProperty({ type: [BookingDetailsPassengerDto] })
  passengers: BookingDetailsPassengerDto[];
  @ApiProperty({
    type: [BookingDetailsLegDto],
    description:
      'An airline moderator only gets the legs operated by their airline',
  })
  legs: BookingDetailsLegDto[];
  @ApiProperty({ nullable: true, type: Number }) baseFareTotal: number | null;
  @ApiProperty({ nullable: true, type: Number })
  extraBaggageTotal: number | null;
  @ApiProperty({ nullable: true, type: Number }) taxesAndFees: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      'null for an airline moderator (the price covers other airlines)',
  })
  totalPrice: number | null;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Policies captured with the passenger details',
  })
  policies: Record<string, unknown> | null;
  @ApiProperty({ nullable: true, type: Date }) policyAcceptedAt: Date | null;
  @ApiProperty({ nullable: true, type: Date }) confirmedAt: Date | null;
  @ApiProperty({ nullable: true, type: Date }) cancelledAt: Date | null;
  @ApiProperty({ nullable: true, type: String })
  cancellationReason: string | null;
  @ApiProperty({ nullable: true, type: Number }) refundAmount: number | null;
  @ApiProperty({
    type: BookingDetailsPaymentDto,
    nullable: true,
    description:
      'Payment summary (status, amount, paidAt); null until paying starts',
  })
  payment: BookingDetailsPaymentDto | null;
  @ApiProperty({ type: Date }) createdAt: Date;
  @ApiProperty({ type: Date }) updatedAt: Date;
}
