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

  @ApiProperty({ minimum: 1, maximum: 9, example: 1 })
  @IsInt()
  @Min(1)
  @Max(9)
  adults: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 9, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9)
  children: number = 0;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 9,
    default: 0,
    description:
      'Infants travel on a lap, need no seat and cannot exceed adults',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9)
  infants: number = 0;
}
