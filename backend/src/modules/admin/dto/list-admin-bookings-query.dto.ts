import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDate, IsEnum, IsIn, IsMongoId, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { BookingStatus, BookingType } from '../../../common/enums';

const ADMIN_BOOKING_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'totalPrice',
  'status',
] as const;

function parseDateBoundary(
  endOfDay: boolean,
): (params: {
  obj?: Record<string, unknown>;
  key: string;
  value: unknown;
}) => unknown {
  return ({ obj, key, value }) => {
    const raw = obj && key in obj ? obj[key] : value;
    if (raw === undefined || raw === null || raw === '') {
      return undefined;
    }
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
      const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
      return new Date(`${raw.trim()}${suffix}`);
    }
    if (raw instanceof Date) {
      return raw;
    }
    if (typeof raw === 'string' || typeof raw === 'number') {
      return new Date(raw);
    }
    return raw;
  };
}

export class ListAdminBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: BookingType,
    description: 'Filter by booking type (flight or hotel)',
  })
  @IsOptional()
  @IsEnum(BookingType)
  bookingType?: BookingType;

  @ApiPropertyOptional({
    enum: BookingStatus,
    description: 'Filter by booking status',
  })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({
    example: '673c1f2a9c4b2d001f8a1234',
    description: 'Filter bookings by user ID',
  })
  @IsOptional()
  @IsMongoId({ message: 'userId must be a valid MongoDB ObjectId' })
  userId?: string;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'Inclusive start date (ISO date or timestamp) on createdAt',
  })
  @IsOptional()
  @Transform(parseDateBoundary(false))
  @IsDate({ message: 'fromDate must be a valid date' })
  fromDate?: Date;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'Inclusive end date (ISO date or timestamp) on createdAt',
  })
  @IsOptional()
  @Transform(parseDateBoundary(true))
  @IsDate({ message: 'toDate must be a valid date' })
  toDate?: Date;

  @ApiPropertyOptional({
    enum: ADMIN_BOOKING_SORT_FIELDS,
    default: 'createdAt',
    description: 'Field to sort bookings by',
  })
  @IsOptional()
  @IsIn(ADMIN_BOOKING_SORT_FIELDS)
  override sortBy?: (typeof ADMIN_BOOKING_SORT_FIELDS)[number] = 'createdAt';
}

export class AdminBookingItemDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1234' })
  id: string;

  @ApiProperty({ enum: BookingType, example: BookingType.FLIGHT })
  bookingType: BookingType;

  @ApiProperty({ example: 'FLT-ABC123' })
  bookingReference: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1111' })
  user: Record<string, unknown> | string;

  @ApiProperty({ enum: BookingStatus, example: BookingStatus.CONFIRMED })
  status: BookingStatus;

  @ApiProperty({ example: 450 })
  totalPrice: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiPropertyOptional()
  details?: Record<string, unknown>;

  @ApiPropertyOptional()
  confirmedAt?: Date;

  @ApiPropertyOptional()
  cancelledAt?: Date;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}

export class PaginatedAdminBookingsResponseDto {
  @ApiProperty({ type: [AdminBookingItemDto] })
  data: AdminBookingItemDto[];

  @ApiProperty({ example: 25 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 2 })
  totalPages: number;
}
