import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { BookingStatus } from '../../../common/enums';

/** GEN-11 lifecycle values a list can be filtered by (HELD is a legacy value no hold uses any more). */
export const LISTABLE_HOTEL_STATUSES = [
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.COMPLETED,
  BookingStatus.EXPIRED,
  BookingStatus.CANCELLED,
] as const;

/** HTL-20: reservations are grouped as Upcoming, Past and Cancelled. */
export enum HotelBookingGroup {
  UPCOMING = 'upcoming',
  PAST = 'past',
  CANCELLED = 'cancelled',
}

export const HOTEL_BOOKING_SORT_FIELDS = [
  'createdAt',
  'checkInDate',
  'totalPrice',
] as const;
export type HotelBookingSortField = (typeof HOTEL_BOOKING_SORT_FIELDS)[number];

export const HOTEL_BOOKING_LIST_DEFAULT_LIMIT = 10;
export const HOTEL_BOOKING_LIST_MAX_LIMIT = 50;

/** Accepts `status=A&status=B` and `status=A,B`; anything else is left for validation to reject. */
function toStatusList({ value }: { value: unknown }): unknown {
  const parts: unknown[] = Array.isArray(value) ? value : [value];
  if (parts.some((part) => typeof part !== 'string')) return value;
  return (parts as string[])
    .flatMap((part) => part.split(','))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Technical bound: a huge page would overflow the skip and end in a 500. */
export const HOTEL_BOOKING_LIST_MAX_PAGE = 100_000;

export class ListHotelBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    default: 1,
    minimum: 1,
    maximum: HOTEL_BOOKING_LIST_MAX_PAGE,
    description: 'Page number',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(HOTEL_BOOKING_LIST_MAX_PAGE)
  override page?: number = 1;

  @ApiPropertyOptional({
    default: HOTEL_BOOKING_LIST_DEFAULT_LIMIT,
    minimum: 1,
    maximum: HOTEL_BOOKING_LIST_MAX_LIMIT,
    description: 'Reservations per page',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(HOTEL_BOOKING_LIST_MAX_LIMIT)
  override limit?: number = HOTEL_BOOKING_LIST_DEFAULT_LIMIT;

  @ApiPropertyOptional({
    enum: LISTABLE_HOTEL_STATUSES,
    isArray: true,
    description:
      'Only reservations in these statuses. Repeat the parameter or comma-separate: status=CONFIRMED,COMPLETED',
    example: 'CONFIRMED,COMPLETED',
  })
  @IsOptional()
  @Transform(toStatusList)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(LISTABLE_HOTEL_STATUSES.length)
  @ArrayUnique()
  @IsIn(LISTABLE_HOTEL_STATUSES, { each: true })
  status?: BookingStatus[];

  @ApiPropertyOptional({
    enum: HotelBookingGroup,
    description:
      'HTL-20 grouping. upcoming = awaiting payment or confirmed (stay not over); past = completed (check-out date passed) or expired; cancelled = cancelled. Combined with status it narrows the result.',
  })
  @IsOptional()
  @IsEnum(HotelBookingGroup)
  group?: HotelBookingGroup;

  @ApiPropertyOptional({
    enum: HOTEL_BOOKING_SORT_FIELDS,
    default: 'createdAt',
    description: 'Sort field',
  })
  @IsOptional()
  @IsIn(HOTEL_BOOKING_SORT_FIELDS)
  override sortBy?: HotelBookingSortField = 'createdAt';
}
