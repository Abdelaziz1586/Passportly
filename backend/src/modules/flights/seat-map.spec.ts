import { CabinClass } from '../../common/enums';
import { buildSeatMap, formatSeat, isSeatInCabin, parseSeat } from './seat-map';

describe('seat map', () => {
  const cabins = [
    { cabinClass: CabinClass.ECONOMY, totalSeats: 20 },
    { cabinClass: CabinClass.FIRST, totalSeats: 4 },
    { cabinClass: CabinClass.BUSINESS, totalSeats: 12 },
  ];

  it('lays the cabins out front to back with continuous row numbers', () => {
    const map = buildSeatMap(cabins);
    expect(map.map((c) => [c.cabinClass, c.firstRow, c.lastRow])).toEqual([
      [CabinClass.FIRST, 1, 1],
      [CabinClass.BUSINESS, 2, 3],
      [CabinClass.ECONOMY, 4, 7],
    ]);
  });

  it('does not depend on the order the cabins are given in', () => {
    expect(buildSeatMap([...cabins].reverse())).toEqual(buildSeatMap(cabins));
  });

  it('handles a cabin that is empty', () => {
    const map = buildSeatMap([{ cabinClass: CabinClass.FIRST, totalSeats: 0 }]);
    expect(map[0]).toMatchObject({ firstRow: 1, lastRow: 0, totalSeats: 0 });
    expect(isSeatInCabin(map[0], { row: 1, letter: 'A' })).toBe(false);
  });

  it('accepts only seats inside the cabin, including a short last row', () => {
    const economy = buildSeatMap(cabins).find(
      (c) => c.cabinClass === CabinClass.ECONOMY,
    )!;
    // 20 seats = rows 4-6 full (18) + row 7 with A and B only
    expect(isSeatInCabin(economy, { row: 4, letter: 'A' })).toBe(true);
    expect(isSeatInCabin(economy, { row: 7, letter: 'B' })).toBe(true);
    expect(isSeatInCabin(economy, { row: 7, letter: 'C' })).toBe(false);
    expect(isSeatInCabin(economy, { row: 3, letter: 'F' })).toBe(false);
    expect(isSeatInCabin(economy, { row: 8, letter: 'A' })).toBe(false);
  });

  it('parses labels strictly', () => {
    expect(parseSeat('12c')).toEqual({ row: 12, letter: 'C' });
    expect(parseSeat(' 1A ')).toEqual({ row: 1, letter: 'A' });
    for (const bad of [
      '',
      'A12',
      '0A',
      '12G',
      '12',
      'C',
      '12CC',
      '-1A',
      '1 A',
      '1000A',
    ]) {
      expect(parseSeat(bad)).toBeNull();
    }
    expect(formatSeat(12, 'C')).toBe('12C');
  });
});
