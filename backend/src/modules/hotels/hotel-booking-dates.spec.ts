import {
  nightsBetween,
  parseStayDate,
  startOfUtcDay,
  stayNights,
} from './hotel-booking-dates';

describe('parseStayDate', () => {
  it('returns UTC midnight', () => {
    expect(parseStayDate('2026-12-10')?.toISOString()).toBe(
      '2026-12-10T00:00:00.000Z',
    );
  });

  it('accepts leap days only in leap years', () => {
    expect(parseStayDate('2028-02-29')).not.toBeNull();
    expect(parseStayDate('2027-02-29')).toBeNull();
  });

  it.each([
    '2026-02-30',
    '2026-13-01',
    '2026-00-10',
    '2026-12-32',
    '2026-12-1',
    '26-12-10',
    '2026/12/10',
    '2026-12-10T00:00:00Z',
    ' 2026-12-10',
    '',
    'tomorrow',
  ])('rejects %j', (value) => {
    expect(parseStayDate(value)).toBeNull();
  });
});

describe('nights', () => {
  const checkIn = new Date('2026-12-30T00:00:00.000Z');

  it('counts nights and lists each stay night at UTC midnight (also across a year end)', () => {
    const checkOut = new Date('2027-01-02T00:00:00.000Z');

    expect(nightsBetween(checkIn, checkOut)).toBe(3);
    expect(stayNights(checkIn, 3).map((d) => d.toISOString())).toEqual([
      '2026-12-30T00:00:00.000Z',
      '2026-12-31T00:00:00.000Z',
      '2027-01-01T00:00:00.000Z',
    ]);
  });

  it('is empty for zero nights', () => {
    expect(stayNights(checkIn, 0)).toEqual([]);
  });
});

describe('startOfUtcDay', () => {
  it('cuts the time off', () => {
    expect(
      startOfUtcDay(new Date('2026-11-19T23:59:59.999Z')).toISOString(),
    ).toBe('2026-11-19T00:00:00.000Z');
  });
});
