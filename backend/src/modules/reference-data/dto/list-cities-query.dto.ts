import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const CITY_SORT_FIELDS = ['name', 'countryCode', 'createdAt'] as const;

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeUpper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class ListCitiesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search across city name, countryCode, or externalId',
    example: 'Cairo',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by ISO country code (case-insensitive)',
    example: 'EG',
    maxLength: 10,
  })
  @IsOptional()
  @Transform(normalizeUpper)
  @IsString()
  @MaxLength(10)
  countryCode?: string;

  @ApiPropertyOptional({
    enum: CITY_SORT_FIELDS,
    default: 'name',
    description: 'Field to sort cities by',
  })
  @IsOptional()
  @IsIn(CITY_SORT_FIELDS)
  override sortBy?: (typeof CITY_SORT_FIELDS)[number] = 'name';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  override sortOrder?: 'asc' | 'desc' = 'asc';
}

export class CityItemDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1234' })
  id: string;

  @ApiPropertyOptional({ example: 'cairo' })
  externalId?: string;

  @ApiProperty({ example: 'Cairo' })
  name: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a2222' })
  countryId: string;

  @ApiProperty({ example: 'EG' })
  countryCode: string;

  @ApiPropertyOptional({ example: 30.0444 })
  latitude?: number;

  @ApiPropertyOptional({ example: 31.2357 })
  longitude?: number;

  @ApiPropertyOptional({ example: 'Africa/Cairo' })
  timezone?: string;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}

export class PaginatedCitiesResponseDto {
  @ApiProperty({ type: [CityItemDto] })
  data: CityItemDto[];

  @ApiProperty({ example: 8 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}
