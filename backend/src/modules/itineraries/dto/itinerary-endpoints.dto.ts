import { ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';

import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

import { ItineraryVisibility } from '../../../common/enums';

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
