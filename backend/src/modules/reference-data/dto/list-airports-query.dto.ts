import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const AIRPORT_SORT_FIELDS = [
  'iataCode',
  'name',
  'cityName',
  'countryCode',
  'timezone',
  'createdAt',
] as const;

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeUpper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class ListAirportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'General search across iataCode, icaoCode, name, cityName, or countryCode',
    example: 'Cairo',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by IATA airport code (case-insensitive)',
    example: 'CAI',
    maxLength: 10,
  })
  @IsOptional()
  @Transform(normalizeUpper)
  @IsString()
  @MaxLength(10)
  iataCode?: string;

  @ApiPropertyOptional({
    description: 'Filter by airport name (partial case-insensitive match)',
    example: 'International',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description: 'Filter by city name, city externalId, or City ObjectId',
    example: 'Cairo',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  city?: string;

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
    enum: AIRPORT_SORT_FIELDS,
    default: 'iataCode',
    description: 'Field to sort airports by',
  })
  @IsOptional()
  @IsIn(AIRPORT_SORT_FIELDS)
  override sortBy?: (typeof AIRPORT_SORT_FIELDS)[number] = 'iataCode';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  override sortOrder?: 'asc' | 'desc' = 'asc';
}

export class AirportItemDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1234' })
  id: string;

  @ApiPropertyOptional({ example: 'airport-1' })
  externalId?: string;

  @ApiProperty({ example: 'CAI' })
  iataCode: string;

  @ApiPropertyOptional({ example: 'HECA' })
  icaoCode?: string;

  @ApiProperty({ example: 'Cairo International Airport' })
  name: string;

  @ApiPropertyOptional({ example: '673c1f2a9c4b2d001f8a2222' })
  cityId?: string;

  @ApiPropertyOptional({ example: 'Cairo' })
  cityName?: string;

  @ApiPropertyOptional({ example: '673c1f2a9c4b2d001f8a3333' })
  countryId?: string;

  @ApiPropertyOptional({ example: 'EG' })
  countryCode?: string;

  @ApiProperty({
    description: 'IANA time zone identifier from Airports.csv',
    example: 'Africa/Cairo',
  })
  timezone: string;

  @ApiPropertyOptional({ example: 30.1219 })
  latitude?: number;

  @ApiPropertyOptional({ example: 31.4056 })
  longitude?: number;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}

export class PaginatedAirportsResponseDto {
  @ApiProperty({ type: [AirportItemDto] })
  data: AirportItemDto[];

  @ApiProperty({ example: 8 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}
