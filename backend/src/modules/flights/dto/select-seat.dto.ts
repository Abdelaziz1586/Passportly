import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsMongoId,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { SEAT_LABEL_PATTERN } from '../seat-map';

export class SelectSeatDto {
  @ApiProperty({
    description:
      'The passenger of this booking to seat (the id shown in the booking details). Infants take no seat.',
    example: '665f1c2e8a1b2c3d4e5f6a7c',
  })
  // Keep the raw value: implicit conversion would turn non-strings into strings.
  @Transform(({ obj }: { obj: { passengerId?: unknown } }) => obj.passengerId)
  @IsMongoId()
  passengerId: string;

  @ApiProperty({
    description:
      'Seat label: a row number and a letter A-F (for example 12C). Rows are numbered through all cabins of the flight; the seat must be in the passenger’s own cabin. Case does not matter.',
    example: '12C',
    pattern: SEAT_LABEL_PATTERN.source,
  })
  @Transform(({ obj }: { obj: { seat?: unknown } }) =>
    typeof obj.seat === 'string' ? obj.seat.trim().toUpperCase() : obj.seat,
  )
  @Matches(SEAT_LABEL_PATTERN, {
    message: 'seat must be a row number and a letter A-F, for example 12C',
  })
  seat: string;

  @ApiPropertyOptional({
    description:
      'Which leg of the booking: 0 = outbound (default), 1 = return of a round trip.',
    minimum: 0,
    maximum: 1,
    default: 0,
    example: 0,
  })
  @Transform(({ obj }: { obj: { legIndex?: unknown } }) => obj.legIndex)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  legIndex?: number;
}
