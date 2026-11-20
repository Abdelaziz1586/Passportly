const DAY_MS = 86_400_000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A stay date such as "2026-12-10" as UTC midnight (2026-12-10T00:00:00.000Z),
 * the form every RoomAvailability night uses. null for anything that is not a
 * real calendar date (e.g. 2026-02-30).
 */
export function parseStayDate(value: string): Date | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Today as UTC midnight. */
export function startOfUtcDay(instant: Date): Date {
  return new Date(
    Date.UTC(
      instant.getUTCFullYear(),
      instant.getUTCMonth(),
      instant.getUTCDate(),
    ),
  );
}

/** Number of nights between check-in and check-out (both UTC midnight). */
export function nightsBetween(checkIn: Date, checkOut: Date): number {
  return Math.round((checkOut.getTime() - checkIn.getTime()) / DAY_MS);
}

/** The stay nights: check-in night up to the night before check-out, each at UTC midnight. */
export function stayNights(checkIn: Date, nights: number): Date[] {
  return Array.from(
    { length: nights },
    (_value, index) => new Date(checkIn.getTime() + index * DAY_MS),
  );
}
