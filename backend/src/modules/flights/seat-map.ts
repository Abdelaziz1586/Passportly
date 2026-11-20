import { CabinClass } from '../../common/enums';

/** FLT-28: every row of every cabin has the seats A-F. */
export const SEAT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export const SEATS_PER_ROW = SEAT_LETTERS.length;

/** Cabins are laid out front to back; rows are numbered from 1 through all cabins of a flight. */
const CABIN_ORDER: CabinClass[] = [
  CabinClass.FIRST,
  CabinClass.BUSINESS,
  CabinClass.PREMIUM_ECONOMY,
  CabinClass.ECONOMY,
];

export interface SeatMapCabinInput {
  cabinClass: CabinClass;
  totalSeats: number;
}

export interface SeatMapCabin {
  cabinClass: CabinClass;
  totalSeats: number;
  firstRow: number;
  lastRow: number;
}

/**
 * The seat map is derived from the cabin capacities (no stored layout): a cabin
 * with N seats has ceil(N / 6) rows, filled A to F, the last row possibly short.
 * Cabins follow each other in the order First, Business, Premium Economy,
 * Economy, so a seat label such as "12C" is unique on the whole flight.
 */
export function buildSeatMap(cabins: SeatMapCabinInput[]): SeatMapCabin[] {
  const sorted = [...cabins].sort(
    (a, b) =>
      CABIN_ORDER.indexOf(a.cabinClass) - CABIN_ORDER.indexOf(b.cabinClass),
  );
  const map: SeatMapCabin[] = [];
  let nextRow = 1;
  for (const cabin of sorted) {
    const seats = Math.max(0, Math.floor(cabin.totalSeats));
    const rows = Math.ceil(seats / SEATS_PER_ROW);
    map.push({
      cabinClass: cabin.cabinClass,
      totalSeats: seats,
      firstRow: nextRow,
      lastRow: nextRow + rows - 1,
    });
    nextRow += rows;
  }
  return map;
}

export const SEAT_LABEL_PATTERN = /^([1-9]\d{0,2})([A-F])$/;

export interface ParsedSeat {
  row: number;
  letter: string;
}

/** "12c" / " 12C " -> { row: 12, letter: 'C' }; anything else is not a seat label. */
export function parseSeat(label: string): ParsedSeat | null {
  const match = SEAT_LABEL_PATTERN.exec(label.trim().toUpperCase());
  if (!match) return null;
  return { row: Number(match[1]), letter: match[2] };
}

export function formatSeat(row: number, letter: string): string {
  return `${row}${letter}`;
}

/** True when the seat really exists in that cabin (inside its rows and not past a short last row). */
export function isSeatInCabin(cabin: SeatMapCabin, seat: ParsedSeat): boolean {
  if (seat.row < cabin.firstRow || seat.row > cabin.lastRow) return false;
  const index =
    (seat.row - cabin.firstRow) * SEATS_PER_ROW +
    SEAT_LETTERS.indexOf(seat.letter as (typeof SEAT_LETTERS)[number]);
  return index < cabin.totalSeats;
}
