import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
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
