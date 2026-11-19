import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  OmitType,
} from '@nestjs/swagger';
import { IsEnum, IsInt, IsPositive, Min, ValidateIf } from 'class-validator';
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
export class CabinUpdate extends PartialType(
  OmitType(CabinCreate, ['cabinClass']),
  { skipNullProperties: false },
) {}
