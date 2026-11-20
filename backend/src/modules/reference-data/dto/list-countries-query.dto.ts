import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const COUNTRY_SORT_FIELDS = [
  'code',
  'name',
  'currencyCode',
  'continent',
  'createdAt',
] as const;

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeUpper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class ListCountriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Search across country code, name, currencyCode, currencyName, or continent',
    example: 'Egypt',
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
  code?: string;

  @ApiPropertyOptional({
    description: 'Filter by 3-letter ISO currency code (case-insensitive)',
    example: 'EGP',
    maxLength: 10,
  })
  @IsOptional()
  @Transform(normalizeUpper)
  @IsString()
  @MaxLength(10)
  currencyCode?: string;

  @ApiPropertyOptional({
    description: 'Filter by continent/region name',
    example: 'Africa',
    maxLength: 60,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(60)
  continent?: string;

  @ApiPropertyOptional({
    enum: COUNTRY_SORT_FIELDS,
    default: 'name',
    description: 'Field to sort countries by',
  })
  @IsOptional()
  @IsIn(COUNTRY_SORT_FIELDS)
  override sortBy?: (typeof COUNTRY_SORT_FIELDS)[number] = 'name';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  override sortOrder?: 'asc' | 'desc' = 'asc';
}

export class CountryItemDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1234' })
  id: string;

  @ApiPropertyOptional({ example: 'country-1' })
  externalId?: string;

  @ApiProperty({ example: 'EG' })
  code: string;

  @ApiProperty({ example: 'Egypt' })
  name: string;

  @ApiProperty({ example: 'EGP' })
  currencyCode: string;

  @ApiPropertyOptional({ example: 'Egyptian Pound' })
  currencyName?: string;

  @ApiPropertyOptional({ example: 'Africa' })
  continent?: string;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}

export class PaginatedCountriesResponseDto {
  @ApiProperty({ type: [CountryItemDto] })
  data: CountryItemDto[];

  @ApiProperty({ example: 8 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}
