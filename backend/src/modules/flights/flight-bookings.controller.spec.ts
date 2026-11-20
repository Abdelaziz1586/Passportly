import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ListFlightBookingsQueryDto } from './dto/list-flight-bookings-query.dto';
import { FlightBookingsController } from './flight-bookings.controller';
import {
  FlightBookingListResponse,
  FlightBookingsService,
} from './flight-bookings.service';

// Read through a plain record so the method references are not "unbound" calls.
const handlers = FlightBookingsController.prototype as unknown as Record<
  string,
  object
>;

describe('FlightBookingsController.listBookings', () => {
  const listBookings = jest.fn();
  const controller = new FlightBookingsController({
    listBookings,
  } as unknown as FlightBookingsService);

  const user: AuthenticatedUser = {
    userId: '665f1c2e8a1b2c3d4e5f6a7b',
    email: 'a@example.com',
    role: Role.REGISTERED_USER,
    jti: 'jti',
  };

  afterEach(() => jest.clearAllMocks());

  it('passes the JWT user id and the validated query to the service', async () => {
    const query = Object.assign(new ListFlightBookingsQueryDto(), { page: 2 });
    const page: FlightBookingListResponse = {
      data: [],
      meta: { page: 2, limit: 10, total: 0, totalPages: 0 },
    };
    listBookings.mockResolvedValue(page);

    await expect(controller.listBookings(query, user)).resolves.toBe(page);
    expect(listBookings).toHaveBeenCalledWith(user.userId, query);
  });

  it('lets an admin list too, and still only their own bookings', async () => {
    const admin = { ...user, role: Role.ADMIN };
    const query = new ListFlightBookingsQueryDto();

    await controller.listBookings(query, admin);

    expect(listBookings).toHaveBeenCalledWith(admin.userId, query);
  });

  it('is restricted to REGISTERED_USER and ADMIN', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      handlers.listBookings,
    ) as Role[];

    expect([...roles].sort()).toEqual(
      [Role.ADMIN, Role.REGISTERED_USER].sort(),
    );
  });

  it('is registered on GET /flight-bookings before the :id route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, handlers.listBookings)).toBe('/');
    expect(Reflect.getMetadata(PATH_METADATA, handlers.getBooking)).toBe(':id');
    const order = Object.getOwnPropertyNames(
      FlightBookingsController.prototype,
    );
    expect(order.indexOf('listBookings')).toBeLessThan(
      order.indexOf('getBooking'),
    );
  });
});
