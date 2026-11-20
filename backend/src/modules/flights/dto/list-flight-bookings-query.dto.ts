import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { BookingStatus } from '../../../common/enums';

/** GEN-11 booking lifecycle. HELD is a legacy enum value that holds no longer use. */
export const LISTABLE_BOOKING_STATUSES = [
  BookingStatus.PENDING_PAYMENT,
  BookingStatus.CONFIRMED,
  BookingStatus.COMPLETED,
  BookingStatus.EXPIRED,
  BookingStatus.CANCELLED,
] as const;

export const FLIGHT_BOOKING_SORT_FIELDS = [
  'createdAt',
  'departureDate',
  'totalPrice',
] as const;
export type FlightBookingSortField =
  (typeof FLIGHT_BOOKING_SORT_FIELDS)[number];

export const FLIGHT_BOOKING_LIST_DEFAULT_LIMIT = 10;
export const FLIGHT_BOOKING_LIST_MAX_LIMIT = 50;

/** Accepts `status=A&status=B` and `status=A,B`; anything else is left for validation to reject. */
function toStatusList({ value }: { value: unknown }): unknown {
  const parts: unknown[] = Array.isArray(value) ? value : [value];
  if (parts.some((part) => typeof part !== 'string')) return value;
  return (parts as string[])
    .flatMap((part) => part.split(','))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export class ListFlightBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    default: FLIGHT_BOOKING_LIST_DEFAULT_LIMIT,
    minimum: 1,
    maximum: FLIGHT_BOOKING_LIST_MAX_LIMIT,
    description: 'Bookings per page',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FLIGHT_BOOKING_LIST_MAX_LIMIT)
  override limit?: number = FLIGHT_BOOKING_LIST_DEFAULT_LIMIT;

  @ApiPropertyOptional({
    enum: LISTABLE_BOOKING_STATUSES,
    isArray: true,
    description:
      'Only bookings in these statuses. Repeat the parameter or comma-separate: status=CONFIRMED,COMPLETED',
    example: 'CONFIRMED,COMPLETED',
  })
  @IsOptional()
  @Transform(toStatusList)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(LISTABLE_BOOKING_STATUSES.length)
  @ArrayUnique()
  @IsIn(LISTABLE_BOOKING_STATUSES, { each: true })
  status?: BookingStatus[];

  @ApiPropertyOptional({
    enum: FLIGHT_BOOKING_SORT_FIELDS,
    default: 'createdAt',
    description:
      'Sort field. departureDate is the departure time of the first (outbound) leg.',
  })
  @IsOptional()
  @IsIn(FLIGHT_BOOKING_SORT_FIELDS)
  override sortBy?: FlightBookingSortField = 'createdAt';
}
