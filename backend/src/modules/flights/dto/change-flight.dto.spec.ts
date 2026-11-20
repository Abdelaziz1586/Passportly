import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ChangeFlightDto, ChangeFlightPreviewDto } from './change-flight.dto';

// Same options as main.ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const parse = <T>(metatype: new () => T, raw: Record<string, unknown>) =>
  pipe.transform(raw, { type: 'body', metatype }) as Promise<T>;

const flightId = '665f1c2e8a1b2c3d4e5f6a7b';
const leg = { legIndex: 0, flightId };

describe('ChangeFlightDto', () => {
  it('accepts one or two legs with acceptPolicies true', async () => {
    const one = await parse(ChangeFlightDto, {
      legs: [leg],
      acceptPolicies: true,
    });
    expect(one.legs).toHaveLength(1);
    const two = await parse(ChangeFlightDto, {
      legs: [leg, { legIndex: 1, flightId }],
      acceptPolicies: true,
      expectedDifference: -12.5,
    });
    expect(two.expectedDifference).toBe(-12.5);
  });

  it.each([
    [{ legs: [leg] }],
    [{ legs: [leg], acceptPolicies: false }],
    [{ legs: [leg], acceptPolicies: 'false' }],
    [{ legs: [leg], acceptPolicies: 'true' }],
    [{ acceptPolicies: true }],
    [{ legs: [], acceptPolicies: true }],
    [{ legs: [leg, leg, leg], acceptPolicies: true }],
    [{ legs: [{ legIndex: 2, flightId }], acceptPolicies: true }],
    [{ legs: [{ legIndex: -1, flightId }], acceptPolicies: true }],
    [{ legs: [{ legIndex: 'x', flightId }], acceptPolicies: true }],
    [{ legs: [{ legIndex: 0, flightId: 'nope' }], acceptPolicies: true }],
    [
      {
        legs: [{ legIndex: 0, flightId: { $ne: null } }],
        acceptPolicies: true,
      },
    ],
    [
      {
        legs: [{ legIndex: 0, flightId, cabinClass: 'FIRST' }],
        acceptPolicies: true,
      },
    ],
    [{ legs: [leg], acceptPolicies: true, expectedDifference: 'abc' }],
    [{ legs: [leg], acceptPolicies: true, expectedDifference: 1.234 }],
    [{ legs: [leg], acceptPolicies: true, totalPrice: 1 }],
    [{ legs: [leg], acceptPolicies: true, user: 'someone' }],
    [{ legs: 'x', acceptPolicies: true }],
  ])('rejects %j', async (raw) => {
    await expect(parse(ChangeFlightDto, raw)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('ChangeFlightPreviewDto', () => {
  it('needs only the legs and rejects acceptPolicies', async () => {
    await expect(
      parse(ChangeFlightPreviewDto, { legs: [leg] }),
    ).resolves.toBeDefined();
    await expect(
      parse(ChangeFlightPreviewDto, { legs: [leg], acceptPolicies: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
