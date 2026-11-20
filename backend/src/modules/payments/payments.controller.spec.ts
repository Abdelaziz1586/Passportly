import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { BookingType, Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BookingPoliciesService } from './booking-policies.service';
import { BookingParamsDto } from './dto/booking-params.dto';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

const handlers = PaymentsController.prototype as unknown as Record<
  string,
  object
>;

describe('PaymentsController PAY-02 (SCRUM-82)', () => {
  const getPolicies = jest.fn();
  const controller = new PaymentsController(
    {} as PaymentsService,
    { getPolicies } as unknown as BookingPoliciesService,
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

  it.each(['getBookingPolicies'])(
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
  });
});
