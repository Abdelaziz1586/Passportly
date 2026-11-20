import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsPositive,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';

export class BaggagePolicy {
  @ApiProperty()
  @IsInt()
  @Min(0)
  carryOnBagsIncluded!: number;

  @ApiProperty()
  @IsPositive()
  carryOnMaxWeightKg!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  checkedBagsIncluded!: number;

  @ApiProperty()
  @IsPositive()
  checkedBagMaxWeightKg!: number;

  @ApiProperty()
  @IsPositive()
  extraBagFee!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  maxExtraBagsPerPassenger!: number;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsNumber()
  @Min(0)
  overweightFeePerKg?: number;

  @ApiProperty()
  @Matches(/^[a-z]{3}$/i)
  currency!: string;
}
