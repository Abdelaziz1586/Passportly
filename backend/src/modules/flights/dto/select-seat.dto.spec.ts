import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SelectSeatDto } from './select-seat.dto';

// Same options as main.ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const parse = (raw: Record<string, unknown>) =>
  pipe.transform(raw, {
    type: 'body',
    metatype: SelectSeatDto,
  }) as Promise<SelectSeatDto>;

const passengerId = '665f1c2e8a1b2c3d4e5f6a7c';

describe('SelectSeatDto', () => {
  it('accepts a seat and normalises its case and spaces', async () => {
    const dto = await parse({ passengerId, seat: ' 12c ' });
    expect(dto.seat).toBe('12C');
    expect(dto.legIndex).toBeUndefined();
  });

  it('accepts leg 0 and 1', async () => {
    expect(
      (await parse({ passengerId, seat: '1A', legIndex: 0 })).legIndex,
    ).toBe(0);
    expect(
      (await parse({ passengerId, seat: '1A', legIndex: 1 })).legIndex,
    ).toBe(1);
  });

  it.each([
    [{ seat: '12C' }],
    [{ passengerId }],
    [{ passengerId: 'nope', seat: '12C' }],
    [{ passengerId: { $ne: null }, seat: '12C' }],
    [{ passengerId, seat: '12G' }],
    [{ passengerId, seat: 12 }],
    [{ passengerId, seat: '' }],
    [{ passengerId, seat: { $gt: '' } }],
    [{ passengerId, seat: '12C', legIndex: 2 }],
    [{ passengerId, seat: '12C', legIndex: -1 }],
    [{ passengerId, seat: '12C', legIndex: 'abc' }],
    [{ passengerId, seat: '12C', legIndex: 0.5 }],
    [{ passengerId, seat: '12C', extra: 1 }],
    [{ passengerId, seat: '12C', user: 'someone' }],
  ])('rejects %j', async (raw) => {
    await expect(parse(raw)).rejects.toBeInstanceOf(BadRequestException);
  });
});
