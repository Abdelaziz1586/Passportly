import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

export const DAY_MS = 86_400_000;
export const PLATFORM_CURRENCY = 'USD';

export function objectId(value: string, field = 'id'): Types.ObjectId {
  if (!/^[a-f\d]{24}$/i.test(value)) {
    throw new BadRequestException(`${field} must be a valid MongoDB ObjectId`);
  }
  return new Types.ObjectId(value);
}

export function utcDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(
      'Dates must be real calendar dates in YYYY-MM-DD format',
    );
  }
  return date;
}

export function todayUtc(): Date {
  return new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
}

/** All hotel ranges are half open: start is included, end is excluded. */
export function dateRange(start: string, end: string, future = false): Date[] {
  const from = utcDate(start);
  const to = utcDate(end);
  const nights = (to.getTime() - from.getTime()) / DAY_MS;
  if (nights < 1 || nights > 366) {
    throw new BadRequestException(
      'End date must be after start date, with at most 366 nights',
    );
  }
  if (future && from < todayUtc()) {
    throw new BadRequestException('Check-in cannot be in the past');
  }
  return Array.from(
    { length: nights },
    (_, i) => new Date(from.getTime() + i * DAY_MS),
  );
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

export function pagination(page = 1, limit = 10) {
  return { page, limit, skip: (page - 1) * limit };
}

export function paged<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
) {
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}
