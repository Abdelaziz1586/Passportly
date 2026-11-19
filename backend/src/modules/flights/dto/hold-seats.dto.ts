import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CabinClass, TripType } from '../../../common/enums';

/**
 * Sanity bound per passenger type, NOT a business rule: the real limit is the
 * seats left in the cabin (a hold fails with 409 when there are not enough).
 */
export const MAX_PASSENGERS_PER_TYPE = 500;

export class HoldLegDto {
  @ApiProperty({
    description: 'Flight to hold seats on',
    example: '665f1c2e8a1b2c3d4e5f6a7b',
  })
  @IsMongoId()
  flightId: string;

  @ApiProperty({ enum: CabinClass, example: CabinClass.ECONOMY })
  @IsEnum(CabinClass)
  cabinClass: CabinClass;
}

export class HoldSeatsDto {
  @ApiProperty({ enum: TripType, example: TripType.ONE_WAY })
  @IsEnum(TripType)
  tripType: TripType;

  @ApiProperty({
    type: [HoldLegDto],
    description:
      'ONE_WAY needs exactly one leg. ROUND_TRIP needs two legs: outbound first, then return.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => HoldLegDto)
  legs: HoldLegDto[];

  @ApiProperty({ minimum: 1, maximum: MAX_PASSENGERS_PER_TYPE, example: 1 })
  @IsInt()
  @Min(1)
  @Max(MAX_PASSENGERS_PER_TYPE)
  adults: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: MAX_PASSENGERS_PER_TYPE,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PASSENGERS_PER_TYPE)
  children: number = 0;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: MAX_PASSENGERS_PER_TYPE,
    default: 0,
    description:
      'Infants (under 2) take no seat, pay 10% of the cabin fare per leg and cannot exceed adults',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PASSENGERS_PER_TYPE)
  infants: number = 0;
}
