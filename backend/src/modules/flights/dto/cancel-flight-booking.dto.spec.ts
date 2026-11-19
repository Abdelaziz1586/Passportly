import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CancelFlightBookingDto } from './cancel-flight-booking.dto';

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
    metatype: CancelFlightBookingDto,
  }) as Promise<CancelFlightBookingDto>;

describe('CancelFlightBookingDto', () => {
  it('accepts confirm=true with or without a reason', async () => {
    expect((await parse({ confirm: true })).confirm).toBe(true);
    expect(
      (await parse({ confirm: true, reason: 'Change of plans' })).reason,
    ).toBe('Change of plans');
  });

  it.each([
    [{}],
    [{ confirm: false }],
    [{ confirm: 'false' }],
    [{ confirm: 'true' }],
    [{ confirm: 'no' }],
    [{ confirm: 1 }],
    [{ confirm: null }],
    [{ confirm: true, reason: '' }],
    [{ confirm: true, reason: 'x'.repeat(301) }],
    [{ confirm: true, reason: 5 }],
    [{ confirm: true, reason: { $ne: null } }],
    // nothing about the money, the status or the owner can come from the client
    [{ confirm: true, refundAmount: 999 }],
    [{ confirm: true, status: 'CANCELLED' }],
    [{ confirm: true, user: '665f1c2e8a1b2c3d4e5f6a7b' }],
  ])('rejects %j', async (raw) => {
    await expect(parse(raw)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a reason of exactly 300 characters', async () => {
    expect(
      (await parse({ confirm: true, reason: 'x'.repeat(300) })).reason,
    ).toHaveLength(300);
  });
});
