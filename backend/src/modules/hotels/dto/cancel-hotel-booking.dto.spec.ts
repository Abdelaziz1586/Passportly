import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CancelHotelBookingDto } from './cancel-hotel-booking.dto';

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
    metatype: CancelHotelBookingDto,
  }) as Promise<CancelHotelBookingDto>;

describe('CancelHotelBookingDto', () => {
  it('accepts confirm=true with an optional reason and an optional previewed refund', async () => {
    expect((await parse({ confirm: true })).confirm).toBe(true);
    expect(
      await parse({
        confirm: true,
        reason: 'Change of plans',
        expectedRefundAmount: 432.4,
      }),
    ).toMatchObject({
      reason: 'Change of plans',
      expectedRefundAmount: 432.4,
    });
    expect(
      (await parse({ confirm: true, expectedRefundAmount: 0 }))
        .expectedRefundAmount,
    ).toBe(0);
    expect(
      (await parse({ confirm: true, reason: 'x'.repeat(300) })).reason,
    ).toHaveLength(300);
  });

  it.each([
    [{}],
    [{ confirm: false }],
    [{ confirm: 'false' }],
    [{ confirm: 'true' }],
    [{ confirm: 1 }],
    [{ confirm: null }],
    [{ confirm: true, reason: '' }],
    [{ confirm: true, reason: 'x'.repeat(301) }],
    [{ confirm: true, reason: 5 }],
    [{ confirm: true, reason: { $ne: null } }],
    [{ confirm: true, expectedRefundAmount: -1 }],
    [{ confirm: true, expectedRefundAmount: 'abc' }],
    [{ confirm: true, expectedRefundAmount: '' }],
    [{ confirm: true, expectedRefundAmount: 10.123 }],
    [{ confirm: true, expectedRefundAmount: 1e12 }],
    // nothing about the money, the status or the owner can come from the client
    [{ confirm: true, refundAmount: 999 }],
    [{ confirm: true, status: 'CANCELLED' }],
    [{ confirm: true, user: '665f1c2e8a1b2c3d4e5f6a7b' }],
    [{ confirm: true, rooms: [] }],
  ])('rejects %j', async (raw) => {
    await expect(parse(raw)).rejects.toBeInstanceOf(BadRequestException);
  });
});
