import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { BookingType } from '../../../common/enums';
import { CreatePaymentDto } from './create-payment.dto';
import { PaymentParamsDto } from './payment-params.dto';

// Same options as main.ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const parseBody = (raw: Record<string, unknown>) =>
  pipe.transform(raw, {
    type: 'body',
    metatype: CreatePaymentDto,
  }) as Promise<CreatePaymentDto>;

const parseParams = (raw: Record<string, unknown>) =>
  pipe.transform(raw, {
    type: 'param',
    metatype: PaymentParamsDto,
  }) as Promise<PaymentParamsDto>;

const id = '665f1c2e8a1b2c3d4e5f6a7b';

describe('CreatePaymentDto', () => {
  it.each([BookingType.FLIGHT, BookingType.HOTEL])('accepts %s', async (t) => {
    const dto = await parseBody({ bookingType: t, bookingId: id });
    expect(dto).toEqual({ bookingType: t, bookingId: id });
  });

  it.each([
    [{ bookingType: 'car', bookingId: id }],
    [{ bookingType: 'flight' }],
    [{ bookingId: id }],
    [{ bookingType: 'flight', bookingId: 'abc' }],
    [{ bookingType: 'flight', bookingId: { $ne: null } }],
    // the price, status or user can never come from the client
    [{ bookingType: 'flight', bookingId: id, amount: 1 }],
    [{ bookingType: 'flight', bookingId: id, currency: 'USD' }],
    [{ bookingType: 'flight', bookingId: id, user: id }],
    [{ bookingType: 'flight', bookingId: id, status: 'SUCCEEDED' }],
  ])('rejects %j', async (raw) => {
    await expect(parseBody(raw)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PaymentParamsDto', () => {
  it('accepts an object id', async () => {
    expect((await parseParams({ id })).id).toBe(id);
  });

  it.each(['abc', '123', '{"$ne":null}', ''])('rejects %j', async (bad) => {
    await expect(parseParams({ id: bad })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
