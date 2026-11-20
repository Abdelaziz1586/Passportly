import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import { ListHotelBookingsQueryDto } from './dto/list-hotel-bookings-query.dto';
import { HotelBookingViewService } from './hotel-booking-view.service';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import { HotelsService } from './hotels.service';

const handlers = HotelBookingsController.prototype as unknown as Record<
  string,
  object
>;

describe('HotelBookingsController.createBooking (HTL-16, HTL-18)', () => {
  const createBooking = jest.fn();
  const controller = new HotelBookingsController(
    {} as HotelsService,
    { createBooking } as unknown as HotelBookingsService,
    {} as HotelBookingViewService,
  );
  const user: AuthenticatedUser = {
    userId: '665f1c2e8a1b2c3d4e5f6a7b',
    email: 'a@example.com',
    role: Role.REGISTERED_USER,
    jti: 'jti',
  };

  afterEach(() => jest.clearAllMocks());

  it('books for the JWT user with the validated body', async () => {
    createBooking.mockResolvedValue({ id: 'b1' });
    const dto = new CreateHotelBookingDto();

    const result = await controller.createBooking(dto, user);

    expect(createBooking).toHaveBeenCalledWith(user.userId, dto);
    expect(result).toEqual({ id: 'b1' });
  });

  it('is for registered users only, on POST hotel-bookings', () => {
    expect(Reflect.getMetadata(ROLES_KEY, handlers.createBooking)).toEqual([
      Role.REGISTERED_USER,
    ]);
    expect(Reflect.getMetadata(PATH_METADATA, handlers.createBooking)).toBe(
      'hotel-bookings',
    );
  });
});

describe('HotelBookingsController HTL-20 list (SCRUM-79)', () => {
  const listBookings = jest.fn();
  const controller = new HotelBookingsController(
    {} as HotelsService,
    {} as HotelBookingsService,
    { listBookings } as unknown as HotelBookingViewService,
  );
  const user: AuthenticatedUser = {
    userId: '665f1c2e8a1b2c3d4e5f6a7b',
    email: 'a@example.com',
    role: Role.REGISTERED_USER,
    jti: 'jti',
  };

  afterEach(() => jest.clearAllMocks());

  it('lists for the JWT user with the validated query, never an owner from the query', async () => {
    listBookings.mockResolvedValue({ data: [] });
    const query = Object.assign(new ListHotelBookingsQueryDto(), { page: 2 });

    await controller.listBookings(query, user);

    expect(listBookings).toHaveBeenCalledWith(user.userId, query);
  });

  it('is for registered users and admins only, on GET hotel-bookings', () => {
    expect(
      [
        ...(Reflect.getMetadata(ROLES_KEY, handlers.listBookings) as Role[]),
      ].sort(),
    ).toEqual([Role.ADMIN, Role.REGISTERED_USER].sort());
    expect(Reflect.getMetadata(PATH_METADATA, handlers.listBookings)).toBe(
      'hotel-bookings',
    );
  });
});
