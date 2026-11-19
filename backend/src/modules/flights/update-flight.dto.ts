import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsInt,
  IsMongoId,
  IsString,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';

export class FlightFields {
  @ApiProperty()
  @IsString()
  @Matches(/\S/)
  flightNumber!: string;

  @ApiProperty()
  @IsMongoId()
  departureAirport!: string;

  @ApiProperty()
  @IsMongoId()
  arrivalAirport!: string;

  @ApiProperty()
  @IsString()
  departureTime!: string;

  @ApiProperty()
  @IsString()
  arrivalTime!: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  aircraftType?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  stopsCount?: number;
}
export class FlightUpdate extends PartialType(FlightFields, {
  skipNullProperties: false,
}) {}
