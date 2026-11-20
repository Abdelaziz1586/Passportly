import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const ATTRACTION_SORT_FIELDS = [
  'name',
  'cityName',
  'countryCode',
  'category',
  'estimatedCost',
  'createdAt',
] as const;

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeUpper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class ListAttractionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Search across name, description, category, cityName, countryCode, or externalId',
    example: 'Pyramids',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by City ObjectId or city externalId (e.g. cairo)',
    example: 'cairo',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  cityId?: string;

  @ApiPropertyOptional({
    description: 'Filter by city name (partial case-insensitive match)',
    example: 'Cairo',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  cityName?: string;

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
    description: 'Filter by attraction category',
    example: 'Historical',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({
    enum: ATTRACTION_SORT_FIELDS,
    default: 'name',
    description: 'Field to sort attractions by',
  })
  @IsOptional()
  @IsIn(ATTRACTION_SORT_FIELDS)
  override sortBy?: (typeof ATTRACTION_SORT_FIELDS)[number] = 'name';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  override sortOrder?: 'asc' | 'desc' = 'asc';
}

export class AttractionItemDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1234' })
  id: string;

  @ApiPropertyOptional({ example: 'att-1' })
  externalId?: string;

  @ApiProperty({ example: 'Giza Pyramids and Sphinx' })
  name: string;

  @ApiPropertyOptional({ example: '673c1f2a9c4b2d001f8a2222' })
  cityId?: string;

  @ApiPropertyOptional({ example: 'Cairo' })
  cityName?: string;

  @ApiPropertyOptional({ example: '673c1f2a9c4b2d001f8a3333' })
  countryId?: string;

  @ApiPropertyOptional({ example: 'EG' })
  countryCode?: string;

  @ApiPropertyOptional({ example: 'Historical' })
  category?: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional({ example: 29.9792 })
  latitude?: number;

  @ApiPropertyOptional({ example: 31.1342 })
  longitude?: number;

  @ApiPropertyOptional({ example: 20 })
  estimatedCost?: number;

  @ApiPropertyOptional({ example: 'USD' })
  currency?: string;

  @ApiPropertyOptional()
  imageUrl?: string;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}

export class PaginatedAttractionsResponseDto {
  @ApiProperty({ type: [AttractionItemDto] })
  data: AttractionItemDto[];

  @ApiProperty({ example: 8 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}
