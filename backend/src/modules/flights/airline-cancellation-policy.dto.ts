import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsNumber,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CancellationTier {
  @ApiProperty()
  @IsInt()
  @Min(0)
  daysBeforeDeparture!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(100)
  refundPercentage!: number;
}

export class CancellationPolicy {
  @ApiProperty({ type: () => CancellationTier, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CancellationTier)
  @ArrayUnique((tier: CancellationTier) => tier?.daysBeforeDeparture)
  tiers!: CancellationTier[];
}
