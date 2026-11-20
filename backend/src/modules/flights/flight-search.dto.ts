import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsString,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import { CabinClass } from '../../common/enums';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class FlightSearch extends PickType(PaginationQueryDto, [
  'page',
  'limit',
]) {
  @ApiProperty()
  @IsString()
  origin!: string;

  @ApiProperty()
  @IsString()
  destination!: string;

  @ApiProperty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  departureDate!: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  returnDate?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  adults?: number;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  children?: number;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  infants?: number;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsEnum(CabinClass)
  cabinClass?: CabinClass;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  maxStops?: number;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Matches(/^[a-z]{3}$/i)
  currency?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(['price', 'duration', 'departure'])
  sort?: 'price' | 'duration' | 'departure';
}
