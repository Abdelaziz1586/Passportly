import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { BookingType, Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BookingPoliciesService } from './booking-policies.service';
import { AcceptPoliciesDto } from './dto/accept-policies.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentParamsDto } from './dto/payment-params.dto';
import { BookingParamsDto } from './dto/booking-params.dto';
import { PaymentWebhookService } from './payment-webhook.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

const handlers = PaymentsController.prototype as unknown as Record<
  string,
  object
>;

describe('PaymentsController PAY-02', () => {
  const getPolicies = jest.fn();
  const acceptPolicies = jest.fn();
  const controller = new PaymentsController(
    {} as PaymentsService,
    { getPolicies, acceptPolicies } as unknown as BookingPoliciesService,
    {} as PaymentWebhookService,
  );
  const user: AuthenticatedUser = {
    userId: '665f1c2e8a1b2c3d4e5f6a7b',
    email: 'a@example.com',
    role: Role.REGISTERED_USER,
    jti: 'jti',
  };
  const params = Object.assign(new BookingParamsDto(), {
    type: BookingType.FLIGHT,
    id: '665f1c2e8a1b2c3d4e5f6a7c',
  });

  afterEach(() => jest.clearAllMocks());

  it('reads policies for the JWT user, never a user from the request', async () => {
    getPolicies.mockResolvedValue({ ok: true });

    await controller.getBookingPolicies(params, user);

    expect(getPolicies).toHaveBeenCalledWith(
      user.userId,
      BookingType.FLIGHT,
      params.id,
    );
  });

  it('accepts policies for the JWT user', async () => {
    acceptPolicies.mockResolvedValue({ ok: true });

    await controller.acceptBookingPolicies(
      params,
      Object.assign(new AcceptPoliciesDto(), { accepted: true }),
      user,
    );

    expect(acceptPolicies).toHaveBeenCalledWith(
      user.userId,
      BookingType.FLIGHT,
      params.id,
    );
  });

  it.each(['getBookingPolicies', 'acceptBookingPolicies'])(
    '%s is for registered users only and not public',
    (name) => {
      expect(Reflect.getMetadata(ROLES_KEY, handlers[name])).toEqual([
        Role.REGISTERED_USER,
      ]);
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handlers[name])).toBeFalsy();
    },
  );

  it('keeps the documented routes', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, handlers.getBookingPolicies),
    ).toBe('bookings/:type/:id/policies');
    expect(
      Reflect.getMetadata(PATH_METADATA, handlers.acceptBookingPolicies),
    ).toBe('bookings/:type/:id/accept-policies');
  });
});

describe('PaymentsController PAY-01', () => {
  const createPayment = jest.fn();
  const retryPayment = jest.fn();
  const getPayment = jest.fn();
  const verifyEvent = jest.fn();
  const handleEvent = jest.fn();
  const controller = new PaymentsController(
    { createPayment, retryPayment, getPayment } as unknown as PaymentsService,
    {} as BookingPoliciesService,
    { verifyEvent, handleEvent } as unknown as PaymentWebhookService,
  );
  const user: AuthenticatedUser = {
    userId: '665f1c2e8a1b2c3d4e5f6a7b',
    email: 'a@example.com',
    role: Role.REGISTERED_USER,
    jti: 'jti',
  };

  afterEach(() => jest.clearAllMocks());

  it('creates payments for the JWT user with the DTO the pipe validated', async () => {
    const dto = Object.assign(new CreatePaymentDto(), {
      bookingType: BookingType.FLIGHT,
      bookingId: '665f1c2e8a1b2c3d4e5f6a7c',
    });

    await controller.createPayment(dto, user);

    expect(createPayment).toHaveBeenCalledWith(user.userId, dto);
  });

  it('retries and reads payments for the JWT user (and role)', async () => {
    const params = Object.assign(new PaymentParamsDto(), {
      id: '665f1c2e8a1b2c3d4e5f6a7d',
    });

    await controller.retryPayment(params, user);
    await controller.getPayment(params, { ...user, role: Role.ADMIN });

    expect(retryPayment).toHaveBeenCalledWith(user.userId, params.id);
    expect(getPayment).toHaveBeenCalledWith(user.userId, Role.ADMIN, params.id);
  });

  it('verifies the raw body and signature before handling the event', async () => {
    const rawBody = Buffer.from('{"id":"evt_1"}');
    const event = { id: 'evt_1' };
    verifyEvent.mockReturnValue(event);
    handleEvent.mockResolvedValue({ received: true, outcome: 'confirmed' });

    const result = await controller.handleWebhook(
      { rawBody } as never,
      't=1,v1=abc',
    );

    expect(verifyEvent).toHaveBeenCalledWith(rawBody, 't=1,v1=abc');
    expect(handleEvent).toHaveBeenCalledWith(event);
    expect(result).toEqual({ received: true, outcome: 'confirmed' });
  });

  it('never handles an event whose signature failed', () => {
    verifyEvent.mockImplementation(() => {
      throw new Error('Invalid Stripe signature');
    });

    expect(() =>
      controller.handleWebhook({ rawBody: Buffer.from('{}') } as never, 'bad'),
    ).toThrow('Invalid Stripe signature');
    expect(handleEvent).not.toHaveBeenCalled();
  });

  it('has the right roles; only the webhook is public', () => {
    const roles = (name: string) =>
      Reflect.getMetadata(ROLES_KEY, handlers[name]) as Role[] | undefined;
    expect(roles('createPayment')).toEqual([Role.REGISTERED_USER]);
    expect(roles('retryPayment')).toEqual([Role.REGISTERED_USER]);
    expect(roles('getPayment')).toEqual([Role.REGISTERED_USER, Role.ADMIN]);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handlers.handleWebhook)).toBe(
      true,
    );
    for (const name of ['createPayment', 'retryPayment', 'getPayment']) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handlers[name])).toBeFalsy();
    }
  });

  it('declares the webhook above the :id routes', () => {
    const order = Object.getOwnPropertyNames(PaymentsController.prototype);
    expect(order.indexOf('handleWebhook')).toBeLessThan(
      order.indexOf('retryPayment'),
    );
    expect(Reflect.getMetadata(PATH_METADATA, handlers.handleWebhook)).toBe(
      'payments/webhook',
    );
  });
});
