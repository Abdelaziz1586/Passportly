import { BookingStatus } from '../../common/enums';
import { HotelBookingGroup } from './dto/list-hotel-bookings-query.dto';
import {
  effectiveHotelStatus,
  groupOfStatus,
  statusCondition,
  statusesToList,
} from './hotel-booking-view';

const now = new Date('2026-12-10T15:30:00.000Z');
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const past = new Date('2026-12-10T15:00:00.000Z');
const future = new Date('2026-12-10T15:40:00.000Z');

describe('effectiveHotelStatus', () => {
  it.each([
    [BookingStatus.PENDING_PAYMENT, past, '2026-12-20', BookingStatus.EXPIRED],
    [BookingStatus.HELD, past, '2026-12-20', BookingStatus.EXPIRED],
    [
      BookingStatus.PENDING_PAYMENT,
      future,
      '2026-12-20',
      BookingStatus.PENDING_PAYMENT,
    ],
    [BookingStatus.HELD, future, '2026-12-20', BookingStatus.PENDING_PAYMENT],
    [
      BookingStatus.PENDING_PAYMENT,
      undefined,
      '2026-12-20',
      BookingStatus.PENDING_PAYMENT,
    ],
    [BookingStatus.CONFIRMED, undefined, '2026-12-20', BookingStatus.CONFIRMED],
    // HTL-23: Completed once the check-out date has passed (today's check-out is not passed yet)
    [BookingStatus.CONFIRMED, undefined, '2026-12-10', BookingStatus.CONFIRMED],
    [BookingStatus.CONFIRMED, undefined, '2026-12-09', BookingStatus.COMPLETED],
    [BookingStatus.COMPLETED, undefined, '2026-12-01', BookingStatus.COMPLETED],
    [BookingStatus.CANCELLED, past, '2026-12-01', BookingStatus.CANCELLED],
    [BookingStatus.EXPIRED, past, '2026-12-20', BookingStatus.EXPIRED],
  ])('%s hold %s check-out %s -> %s', (status, hold, checkOut, expected) => {
    expect(
      effectiveHotelStatus(
        { status, holdExpiresAt: hold, checkOutDate: day(checkOut) },
        now,
      ),
    ).toBe(expected);
  });
});

describe('groups', () => {
  it.each([
    [BookingStatus.PENDING_PAYMENT, HotelBookingGroup.UPCOMING],
    [BookingStatus.CONFIRMED, HotelBookingGroup.UPCOMING],
    [BookingStatus.COMPLETED, HotelBookingGroup.PAST],
    [BookingStatus.EXPIRED, HotelBookingGroup.PAST],
    [BookingStatus.CANCELLED, HotelBookingGroup.CANCELLED],
  ])('%s is %s', (status, group) => {
    expect(groupOfStatus(status)).toBe(group);
  });

  it('lists every status without a group or status filter', () => {
    expect([...statusesToList(undefined, undefined)].sort()).toEqual(
      [
        BookingStatus.PENDING_PAYMENT,
        BookingStatus.CONFIRMED,
        BookingStatus.COMPLETED,
        BookingStatus.EXPIRED,
        BookingStatus.CANCELLED,
      ].sort(),
    );
  });

  it('uses the group, the statuses, or their intersection', () => {
    expect(statusesToList(HotelBookingGroup.PAST, undefined)).toEqual([
      BookingStatus.COMPLETED,
      BookingStatus.EXPIRED,
    ]);
    expect(
      statusesToList(undefined, [
        BookingStatus.CONFIRMED,
        BookingStatus.CANCELLED,
      ]),
    ).toEqual([BookingStatus.CONFIRMED, BookingStatus.CANCELLED]);
    expect(
      statusesToList(HotelBookingGroup.UPCOMING, [
        BookingStatus.CONFIRMED,
        BookingStatus.CANCELLED,
      ]),
    ).toEqual([BookingStatus.CONFIRMED]);
  });

  it('is empty when the group and the statuses do not overlap', () => {
    expect(
      statusesToList(HotelBookingGroup.CANCELLED, [BookingStatus.CONFIRMED]),
    ).toEqual([]);
  });
});

describe('statusCondition mirrors the effective status', () => {
  const today = day('2026-12-10');

  it('PENDING_PAYMENT = an unpaid hold still running', () => {
    expect(statusCondition(BookingStatus.PENDING_PAYMENT, now)).toEqual({
      status: { $in: [BookingStatus.PENDING_PAYMENT, BookingStatus.HELD] },
      holdExpiresAt: { $gt: now },
    });
  });

  it('EXPIRED = flipped, or a lapsed hold the job has not flipped yet', () => {
    expect(statusCondition(BookingStatus.EXPIRED, now)).toEqual({
      $or: [
        { status: BookingStatus.EXPIRED },
        {
          status: { $in: [BookingStatus.PENDING_PAYMENT, BookingStatus.HELD] },
          holdExpiresAt: { $lte: now },
        },
      ],
    });
  });

  it('CONFIRMED excludes a stay whose check-out date passed; COMPLETED includes it', () => {
    expect(statusCondition(BookingStatus.CONFIRMED, now)).toEqual({
      status: BookingStatus.CONFIRMED,
      checkOutDate: { $gte: today },
    });
    expect(statusCondition(BookingStatus.COMPLETED, now)).toEqual({
      $or: [
        { status: BookingStatus.COMPLETED },
        { status: BookingStatus.CONFIRMED, checkOutDate: { $lt: today } },
      ],
    });
  });

  it('CANCELLED is a plain status match', () => {
    expect(statusCondition(BookingStatus.CANCELLED, now)).toEqual({
      status: BookingStatus.CANCELLED,
    });
  });
});
