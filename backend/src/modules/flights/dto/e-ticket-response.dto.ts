import { ApiProperty } from '@nestjs/swagger';
import {
  BookingStatus,
  CabinClass,
  PassengerType,
  TripType,
} from '../../../common/enums';

/** Swagger-only shapes: they document what FlightETicketService returns. */

export class ETicketAirportDto {
  @ApiProperty({ example: 'CAI' }) iataCode: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) city: string | null;
  @ApiProperty({ example: 'Africa/Cairo', description: 'IANA time zone' })
  timezone: string;
}

export class ETicketEndpointDto {
  @ApiProperty({ type: ETicketAirportDto }) airport: ETicketAirportDto;
  @ApiProperty({ type: Date, description: 'The instant in UTC' }) utc: Date;
  @ApiProperty({
    example: '2026-12-01 14:30',
    description: "The same instant in the airport's own time zone",
  })
  localTime: string;
  @ApiProperty({ example: 'GMT+02:00' }) utcOffset: string;
}

export class ETicketLegDto {
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
  @ApiProperty() durationMinutes: number;
  @ApiProperty({ type: ETicketEndpointDto }) departure: ETicketEndpointDto;
  @ApiProperty({ type: ETicketEndpointDto }) arrival: ETicketEndpointDto;
  @ApiProperty({ type: [String] }) seatNumbers: string[];
}

export class ETicketPassengerDto {
  @ApiProperty() firstName: string;
  @ApiProperty() lastName: string;
  @ApiProperty({ enum: PassengerType }) type: PassengerType;
  @ApiProperty({ nullable: true, type: String }) eTicketNumber: string | null;
  @ApiProperty({ description: 'Masked: only the last 4 characters' })
  passportNumber: string;
  @ApiProperty() extraBaggageCount: number;
  @ApiProperty({ type: [String] }) seatAssignments: string[];
}

export class ETicketResponseDto {
  @ApiProperty() bookingId: string;
  @ApiProperty({ description: 'The booking reference (PNR)' })
  bookingReference: string;
  @ApiProperty({ enum: BookingStatus }) status: BookingStatus;
  @ApiProperty({ enum: TripType }) tripType: TripType;
  @ApiProperty({ nullable: true, type: Date }) issuedAt: Date | null;
  @ApiProperty({ type: [ETicketPassengerDto] })
  passengers: ETicketPassengerDto[];
  @ApiProperty({ type: [ETicketLegDto] }) legs: ETicketLegDto[];
  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      'null for an airline moderator: the price also covers legs of other airlines',
  })
  totalPrice: number | null;
  @ApiProperty({ example: 'USD' }) currency: string;
}
