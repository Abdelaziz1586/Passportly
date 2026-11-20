import {
  airportLocalTime,
  assertLocalDate,
  flightInstant,
} from './flight-time';

describe('airport-local scheduling', () => {
  it('keeps the airport date when UTC is on the previous day', () => {
    const departure = flightInstant('2027-01-02T01:30', 'Asia/Tokyo');
    expect(departure.toISOString()).toBe('2027-01-01T16:30:00.000Z');
    expect(airportLocalTime(departure, 'Asia/Tokyo')).toBe(
      '2027-01-02T01:30:00+09:00',
    );
  });

  it('rejects nonexistent local times and requires an offset in an overlap', () => {
    expect(() =>
      flightInstant('2026-03-08T02:30', 'America/New_York'),
    ).toThrow();
    expect(() =>
      flightInstant('2026-11-01T01:30', 'America/New_York'),
    ).toThrow();
    expect(
      flightInstant('2026-11-01T01:30-04:00', 'America/New_York').toISOString(),
    ).toBe('2026-11-01T05:30:00.000Z');
    expect(
      flightInstant('2026-11-01T01:30-05:00', 'America/New_York').toISOString(),
    ).toBe('2026-11-01T06:30:00.000Z');
    expect(() =>
      flightInstant('2026-11-01T01:30-06:00', 'America/New_York'),
    ).toThrow();
  });

  it('rejects invalid calendar dates', () => {
    expect(() => assertLocalDate('2027-02-29')).toThrow();
    expect(() => assertLocalDate('2028-02-29')).not.toThrow();
  });
});
