import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { BookingStatus } from '../../../common/enums';
import { HotelBookingIdParamDto } from './hotel-booking-id-param.dto';
import { ListHotelBookingsQueryDto } from './list-hotel-bookings-query.dto';

// Same options as main.ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const parse = (raw: Record<string, unknown>) =>
  pipe.transform(raw, {
    type: 'query',
    metatype: ListHotelBookingsQueryDto,
  }) as Promise<ListHotelBookingsQueryDto>;

describe('ListHotelBookingsQueryDto', () => {
  it('applies the defaults', async () => {
    const dto = await parse({});

    expect(dto).toMatchObject({
      page: 1,
      limit: 10,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    expect(dto.status).toBeUndefined();
    expect(dto.group).toBeUndefined();
  });

  it('coerces page and limit and accepts every sort field and group', async () => {
    expect(await parse({ page: '3', limit: '50' })).toMatchObject({
      page: 3,
      limit: 50,
    });
    for (const sortBy of ['createdAt', 'checkInDate', 'totalPrice']) {
      expect((await parse({ sortBy })).sortBy).toBe(sortBy);
    }
    for (const group of ['upcoming', 'past', 'cancelled']) {
      expect((await parse({ group })).group).toBe(group);
    }
  });

  it('accepts one status, repeated statuses and comma-separated statuses', async () => {
    expect((await parse({ status: 'CONFIRMED' })).status).toEqual([
      BookingStatus.CONFIRMED,
    ]);
    expect(
      (await parse({ status: ['CONFIRMED', 'CANCELLED'] })).status,
    ).toEqual([BookingStatus.CONFIRMED, BookingStatus.CANCELLED]);
    expect((await parse({ status: 'CONFIRMED, COMPLETED' })).status).toEqual([
      BookingStatus.CONFIRMED,
      BookingStatus.COMPLETED,
    ]);
  });

  it.each([
    [{ page: '0' }],
    [{ page: 'abc' }],
    [{ limit: '0' }],
    [{ limit: '51' }],
    [{ status: 'HELD' }],
    [{ status: 'NOPE' }],
    [{ status: 'CONFIRMED,CONFIRMED' }],
    [{ status: '' }],
    [{ status: { $ne: 'CANCELLED' } }],
    [{ group: 'future' }],
    [{ group: 'UPCOMING' }],
    [{ sortBy: 'user' }],
    [{ sortBy: '$where' }],
    [{ sortOrder: 'sideways' }],
    // the owner can never come from the query
    [{ user: '665f1c2e8a1b2c3d4e5f6a7b' }],
    [{ userId: '665f1c2e8a1b2c3d4e5f6a7b' }],
    [{ hotel: '665f1c2e8a1b2c3d4e5f6a7b' }],
  ])('rejects %j', async (raw) => {
    await expect(parse(raw)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('HotelBookingIdParamDto', () => {
  const parse = (id: unknown) =>
    pipe.transform(
      { id },
      { type: 'param', metatype: HotelBookingIdParamDto },
    ) as Promise<HotelBookingIdParamDto>;

  it('accepts an object id and rejects anything else', async () => {
    expect((await parse('665f1c2e8a1b2c3d4e5f6a7b')).id).toBe(
      '665f1c2e8a1b2c3d4e5f6a7b',
    );
    for (const bad of ['abc', '123', '{"$ne":null}']) {
      await expect(parse(bad)).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});
