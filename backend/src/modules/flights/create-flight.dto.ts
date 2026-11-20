import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsPositive,
  IsString,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CabinClass } from '../../common/enums';

export class CabinCreate {
  @ApiProperty()
  @IsEnum(CabinClass)
  cabinClass!: CabinClass;

  @ApiProperty()
  @IsInt()
  @Min(1)
  totalSeats!: number;

  @ApiProperty()
  @IsPositive()
  basePrice!: number;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  checkedBagsIncludedOverride?: number;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsPositive()
  checkedBagMaxWeightKgOverride?: number;
}

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
export class FlightCreate extends FlightFields {
  @ApiProperty()
  @IsMongoId()
  airlineId!: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Matches(/^[a-z]{3}$/i)
  baseCurrency?: string;

  @ApiPropertyOptional({ type: () => CabinCreate, isArray: true })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CabinCreate)
  @ArrayUnique((cabin: CabinCreate) => cabin?.cabinClass)
  cabins?: CabinCreate[];
}

export class CabinUpdate extends PartialType(
  OmitType(CabinCreate, ['cabinClass']),
  { skipNullProperties: false },
) {}
