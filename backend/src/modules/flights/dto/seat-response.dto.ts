import { ApiProperty } from '@nestjs/swagger';
import { CabinClass } from '../../../common/enums';

export class SeatSelectionResponseDto {
  @ApiProperty() bookingId: string;
  @ApiProperty() bookingReference: string;
  @ApiProperty({ example: 0 }) legIndex: number;
  @ApiProperty() flightId: string;
  @ApiProperty({ enum: CabinClass }) cabinClass: CabinClass;
  @ApiProperty() passengerId: string;
  @ApiProperty({ example: '12C' }) seat: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The seat the passenger had before on this leg, now free again',
  })
  previousSeat: string | null;
  @ApiProperty({
    type: [String],
    description: 'All seats chosen on this leg, in passenger order',
  })
  legSeats: string[];
}

export class SeatMapPassengerSeatDto {
  @ApiProperty() passengerId: string;
  @ApiProperty({ example: '12C' }) seat: string;
}

export class SeatMapLegDto {
  @ApiProperty() legIndex: number;
  @ApiProperty() flightId: string;
  @ApiProperty() flightNumber: string;
  @ApiProperty({ enum: CabinClass }) cabinClass: CabinClass;
  @ApiProperty({ type: [String], example: ['A', 'B', 'C', 'D', 'E', 'F'] })
  seatLetters: string[];
  @ApiProperty({ description: 'First row of this cabin' }) firstRow: number;
  @ApiProperty({ description: 'Last row of this cabin (may be a short row)' })
  lastRow: number;
  @ApiProperty({ description: 'Seats in this cabin' }) totalSeats: number;
  @ApiProperty({
    type: [String],
    description: 'Seats of this cabin taken by anyone (including this booking)',
  })
  takenSeats: string[];
  @ApiProperty({ type: [SeatMapPassengerSeatDto] })
  yourSeats: SeatMapPassengerSeatDto[];
  @ApiProperty({
    description: 'False once the leg has departed or the flight is cancelled',
  })
  selectable: boolean;
}

export class SeatMapResponseDto {
  @ApiProperty() bookingId: string;
  @ApiProperty() bookingReference: string;
  @ApiProperty({ type: [SeatMapLegDto] }) legs: SeatMapLegDto[];
}
