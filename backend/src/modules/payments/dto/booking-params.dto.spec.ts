import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { BookingType } from '../../../common/enums';
import { BookingParamsDto } from './booking-params.dto';

// Same options as main.ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const parseParams = (raw: Record<string, unknown>) =>
  pipe.transform(raw, {
    type: 'param',
    metatype: BookingParamsDto,
  }) as Promise<BookingParamsDto>;

describe('BookingParamsDto', () => {
  const id = '665f1c2e8a1b2c3d4e5f6a7b';

  it.each([BookingType.FLIGHT, BookingType.HOTEL])(
    'accepts type %s',
    async (type) => {
      expect((await parseParams({ type, id })).type).toBe(type);
    },
  );

  it.each(['car', 'FLIGHT', '', 'flights'])('rejects type %j', async (type) => {
    await expect(parseParams({ type, id })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each(['abc', '123', '{"$ne":null}', ''])(
    'rejects id %j',
    async (badId) => {
      await expect(
        parseParams({ type: 'flight', id: badId }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});
