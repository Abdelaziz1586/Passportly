import { BadRequestException } from '@nestjs/common';

function localParts(date: Date, zone: string): string {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return formatter.format(date).replace(' ', 'T');
}

export function airportLocalTime(date: Date, zone: string) {
  const local = localParts(date, zone);
  const offset = Math.round((Date.parse(local + 'Z') - date.getTime()) / 60000);
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0');
  return local + (offset < 0 ? '-' : '+') + hours + ':' + minutes;
}

export function flightInstant(input: string, zone: string): Date {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?(Z|[+-]\d{2}:\d{2})?$/.exec(
      input,
    );
  if (!match) throw new BadRequestException('Use an ISO local date and time');
  const local = match[1] + (match[2] ?? ':00');
  const naive = Date.parse(local + 'Z');
  if (match[3]) {
    const date = new Date(local + match[3]);
    if (!Number.isFinite(date.getTime()) || localParts(date, zone) !== local) {
      throw new BadRequestException(
        'Offset does not match the airport local time',
      );
    }
    return date;
  }
  const matches = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const sample = naive + hours * 3600000;
    if (!Number.isFinite(sample)) break;
    const offset =
      Date.parse(localParts(new Date(sample), zone) + 'Z') - sample;
    const instant = naive - offset;
    if (localParts(new Date(instant), zone) === local) matches.add(instant);
  }
  if (matches.size !== 1) {
    throw new BadRequestException(
      'Invalid or ambiguous airport local time; specify an offset for ambiguous times',
    );
  }
  return new Date([...matches][0]);
}

export function assertLocalDate(value: string) {
  const parsed = new Date(value + 'T00:00:00Z');
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('Invalid calendar date');
  }
}
