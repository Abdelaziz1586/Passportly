import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { HoldSeatsDto } from './hold-seats.dto';

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
    metatype: HoldSeatsDto,
  }) as Promise<HoldSeatsDto>;

const base = {
  tripType: 'ONE_WAY',
  adults: 1,
  legs: [{ flightId: '665f1c2e8a1b2c3d4e5f6a7b', cabinClass: 'ECONOMY' }],
};

describe('HoldSeatsDto passenger counts', () => {
  it('defaults omitted children and infants to 0', async () => {
    const dto = await parse(base);
    expect(dto.children).toBe(0);
    expect(dto.infants).toBe(0);
  });

  it('keeps explicit numbers', async () => {
    const dto = await parse({ ...base, adults: 2, children: 1, infants: 1 });
    expect([dto.adults, dto.children, dto.infants]).toEqual([2, 1, 1]);
  });

  it.each([
    [{ children: null }],
    [{ infants: null }],
    [{ children: null, infants: null }],
    [{ children: 'x' }],
    [{ infants: -1 }],
    [{ children: 1.5 }],
  ])('rejects %j instead of storing it', async (extra) => {
    await expect(parse({ ...base, ...extra })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('still rejects missing or null adults', async () => {
    await expect(
      parse({ tripType: 'ONE_WAY', legs: base.legs }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(parse({ ...base, adults: null })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
