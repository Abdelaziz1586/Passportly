import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { BookingType, Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BookingPoliciesService } from './booking-policies.service';
import { AcceptPoliciesDto } from './dto/accept-policies.dto';
import { BookingParamsDto } from './dto/booking-params.dto';
import { PaymentsController } from './payments.controller';
import { CreatePaymentDto } from './dto/create-payment.dto';
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

describe('PaymentsController PAY-01 create (SCRUM-84)', () => {
  const createPayment = jest.fn();
  const controller = new PaymentsController(
    { createPayment } as unknown as PaymentsService,
    {} as BookingPoliciesService,
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

  it('is for registered users only and not public', () => {
    expect(Reflect.getMetadata(ROLES_KEY, handlers.createPayment)).toEqual([
      Role.REGISTERED_USER,
    ]);
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, handlers.createPayment),
    ).toBeFalsy();
  });

  it('keeps the documented route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, handlers.createPayment)).toBe(
      'payments',
    );
  });
});
