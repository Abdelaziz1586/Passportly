import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { BookingStatus } from '../../../common/enums';
import { ListFlightBookingsQueryDto } from './list-flight-bookings-query.dto';

// Same options as main.ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: ListFlightBookingsQueryDto,
};

const parse = (raw: Record<string, unknown>) =>
  pipe.transform(raw, metadata) as Promise<ListFlightBookingsQueryDto>;

describe('ListFlightBookingsQueryDto', () => {
  it('applies the defaults', async () => {
    const dto = await parse({});

    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(10);
    expect(dto.sortBy).toBe('createdAt');
    expect(dto.sortOrder).toBe('desc');
    expect(dto.status).toBeUndefined();
  });

  it('coerces page and limit from strings', async () => {
    const dto = await parse({ page: '2', limit: '50' });

    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
  });

  it.each([
    [{ page: '0' }],
    [{ page: '-1' }],
    [{ page: '1.5' }],
    [{ page: 'abc' }],
    [{ limit: '0' }],
    [{ limit: '51' }],
    [{ limit: '1000' }],
    [{ limit: 'abc' }],
  ])('rejects bad pagination %j', async (raw) => {
    await expect(parse(raw)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['createdAt', 'departureDate', 'totalPrice'])(
    'accepts sortBy=%s',
    async (sortBy) => {
      expect((await parse({ sortBy })).sortBy).toBe(sortBy);
    },
  );

  it.each([
    'status',
    'user',
    'passengers.passportNumber',
    '$where',
    'legs.0.departureTime',
    '',
  ])('rejects sortBy=%j', async (sortBy) => {
    await expect(parse({ sortBy })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([['asc'], ['desc']])('accepts sortOrder=%s', async (sortOrder) => {
    expect((await parse({ sortOrder })).sortOrder).toBe(sortOrder);
  });

  it.each([['ASC'], ['up'], ['1'], ['']])(
    'rejects sortOrder=%j',
    async (sortOrder) => {
      await expect(parse({ sortOrder })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  describe('status', () => {
    it.each(
      Object.values(BookingStatus).filter((s) => s !== BookingStatus.HELD),
    )('accepts a single %s', async (status) => {
      expect((await parse({ status })).status).toEqual([status]);
    });

    it('accepts a repeated parameter', async () => {
      const dto = await parse({ status: ['CONFIRMED', 'CANCELLED'] });

      expect(dto.status).toEqual(['CONFIRMED', 'CANCELLED']);
    });

    it('accepts a comma-separated list (with spaces)', async () => {
      const dto = await parse({ status: 'CONFIRMED, COMPLETED' });

      expect(dto.status).toEqual(['CONFIRMED', 'COMPLETED']);
    });

    it('accepts repeated and comma-separated mixed', async () => {
      const dto = await parse({ status: ['CONFIRMED,COMPLETED', 'EXPIRED'] });

      expect(dto.status).toEqual(['CONFIRMED', 'COMPLETED', 'EXPIRED']);
    });

    it.each([
      ['bogus'],
      ['confirmed'],
      ['HELD'],
      [''],
      [','],
      ['CONFIRMED,bogus'],
      [['CONFIRMED', 'bogus']],
      ['CONFIRMED,CONFIRMED'],
      [{ $ne: 'CONFIRMED' }],
    ])('rejects status=%j', async (status) => {
      await expect(parse({ status })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  it.each([
    [{ user: '665f1c2e8a1b2c3d4e5f6a7b' }],
    [{ userId: '665f1c2e8a1b2c3d4e5f6a7b' }],
    [{ foo: 'bar' }],
  ])(
    'rejects unknown parameter %j (the owner is never read from the query)',
    async (raw) => {
      await expect(parse(raw)).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});
