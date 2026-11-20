import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Transform, Type } from 'class-transformer';

import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

import { BudgetCategory, ItineraryVisibility } from '../../../common/enums';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeCurrency = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class ListItinerariesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ItineraryVisibility })
  @IsOptional()
  @IsEnum(ItineraryVisibility)
  visibility?: ItineraryVisibility;

  @ApiPropertyOptional({
    description: 'Search itinerary titles and descriptions',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  search?: string;
}

export class UpdateItineraryDto {
  @ApiPropertyOptional({ example: 'Updated trip title' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiPropertyOptional({ example: 'Updated trip description' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['673c1f2a9c4b2d001f8a1234'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  countries?: string[];

  @ApiPropertyOptional({ example: '2027-06-15' })
  @IsOptional()
  @IsDateString({ strict: true })
  startDate?: string;

  @ApiPropertyOptional({ example: 'EUR', minLength: 3, maxLength: 3 })
  @IsOptional()
  @Transform(normalizeCurrency)
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/)
  displayCurrency?: string;

  @ApiPropertyOptional({ enum: ItineraryVisibility })
  @IsOptional()
  @IsEnum(ItineraryVisibility)
  visibility?: ItineraryVisibility;
}

export class CreateItineraryDayDto {
  @ApiPropertyOptional({ description: 'MongoDB city ID' })
  @IsOptional()
  @IsMongoId()
  cityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  cityName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  notes?: string;
}

export class UpdateItineraryDayDto {
  @ApiPropertyOptional({ description: 'MongoDB city ID' })
  @IsOptional()
  @IsMongoId()
  cityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  cityName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  notes?: string;
}

export class ReorderItineraryDaysDto {
  @ApiProperty({ type: [String], example: ['673c1f2a9c4b2d001f8a1234'] })
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  dayIds: string[];
}

export class CreateActivityDto {
  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Optional MongoDB attraction ID' })
  @IsOptional()
  @IsMongoId()
  attractionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  locationName?: string;

  @ApiPropertyOptional({
    example: '09:30',
    pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
  })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime?: string;

  @ApiPropertyOptional({
    example: '11:00',
    pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
  })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endTime?: string;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  orderIndex?: number;
}

export class UpdateActivityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Optional MongoDB attraction ID' })
  @IsOptional()
  @IsMongoId()
  attractionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  locationName?: string;

  @ApiPropertyOptional({
    example: '09:30',
    pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
  })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime?: string;

  @ApiPropertyOptional({
    example: '11:00',
    pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
  })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endTime?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  orderIndex?: number;
}

export class CreateBudgetEntryDto {
  @ApiProperty({ enum: BudgetCategory })
  @IsEnum(BudgetCategory)
  category: BudgetCategory;

  @ApiProperty()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimString)
  @IsString()
  notes?: string;

  @ApiProperty({ minimum: 0, example: 45.5 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiProperty({ example: 'USD', minLength: 3, maxLength: 3 })
  @Transform(normalizeCurrency)
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/)
  currency: string;
}
