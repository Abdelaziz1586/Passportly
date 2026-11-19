import 'reflect-metadata';
import { StreamableFile } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ListFlightBookingsQueryDto } from './dto/list-flight-bookings-query.dto';
import { FlightBookingsController } from './flight-bookings.controller';
import { ETicketFormat, ETicketQueryDto } from './dto/e-ticket-query.dto';
import { FlightBookingIdParamDto } from './dto/flight-booking-id-param.dto';
import { FlightBookingViewService } from './flight-booking-view.service';
import { FlightCancellationService } from './flight-cancellation.service';
import { CancelFlightBookingDto } from './dto/cancel-flight-booking.dto';
import { FlightETicketService } from './flight-e-ticket.service';
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
  const controller = new FlightBookingsController(
    { listBookings } as unknown as FlightBookingsService,
    {} as FlightETicketService,
    {} as FlightBookingViewService,
    {} as FlightCancellationService,
  );

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

describe('FlightBookingsController.getETicket (FLT-23)', () => {
  const getETicket = jest.fn();
  const toPdf = jest.fn();
  const controller = new FlightBookingsController(
    {} as FlightBookingsService,
    { getETicket, toPdf } as unknown as FlightETicketService,
    {} as FlightBookingViewService,
    {} as FlightCancellationService,
  );
  const user: AuthenticatedUser = {
    userId: '665f1c2e8a1b2c3d4e5f6a7b',
    email: 'a@example.com',
    role: Role.REGISTERED_USER,
    jti: 'jti',
  };
  const params = Object.assign(new FlightBookingIdParamDto(), {
    id: '665f1c2e8a1b2c3d4e5f6a7c',
  });
  const ticket = { bookingReference: 'ABCD2345' };

  afterEach(() => jest.clearAllMocks());

  it('returns the JSON ticket for the JWT user by default', async () => {
    getETicket.mockResolvedValue(ticket);

    const result = await controller.getETicket(
      params,
      new ETicketQueryDto(),
      user,
    );

    expect(getETicket).toHaveBeenCalledWith(user, params.id);
    expect(result).toBe(ticket);
    expect(toPdf).not.toHaveBeenCalled();
  });

  it('streams a PDF attachment named after the booking reference with ?format=pdf', async () => {
    getETicket.mockResolvedValue(ticket);
    toPdf.mockReturnValue(Buffer.from('%PDF-1.4'));

    const result = await controller.getETicket(
      params,
      Object.assign(new ETicketQueryDto(), { format: ETicketFormat.PDF }),
      user,
    );

    expect(result).toBeInstanceOf(StreamableFile);
    const headers = (result as StreamableFile).getHeaders();
    expect(headers.type).toBe('application/pdf');
    expect(headers.disposition).toBe(
      'attachment; filename="e-ticket-ABCD2345.pdf"',
    );
  });

  it('is open to the owner, admins and airline moderators only', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, handlers.getETicket) as Role[];
    expect([...roles].sort()).toEqual(
      [Role.ADMIN, Role.AIRLINE_MODERATOR, Role.REGISTERED_USER].sort(),
    );
    expect(Reflect.getMetadata(PATH_METADATA, handlers.getETicket)).toBe(
      ':id/e-ticket',
    );
  });
});

describe('FlightBookingsController.getBooking (FLT-25 details)', () => {
  const getBooking = jest.fn();
  const controller = new FlightBookingsController(
    {} as FlightBookingsService,
    {} as FlightETicketService,
    { getBooking } as unknown as FlightBookingViewService,
    {} as FlightCancellationService,
  );
  const user: AuthenticatedUser = {
    userId: '665f1c2e8a1b2c3d4e5f6a7b',
    email: 'a@example.com',
    role: Role.REGISTERED_USER,
    jti: 'jti',
  };

  afterEach(() => jest.clearAllMocks());

  it('reads the booking for the JWT user, never an owner from the request', async () => {
    getBooking.mockResolvedValue({ id: 'b1' });
    const params = Object.assign(new FlightBookingIdParamDto(), {
      id: '665f1c2e8a1b2c3d4e5f6a7c',
    });

    const result = await controller.getBooking(params, user);

    expect(getBooking).toHaveBeenCalledWith(user, params.id);
    expect(result).toEqual({ id: 'b1' });
  });

  it('is open to the owner, admins and airline moderators only', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, handlers.getBooking) as Role[];
    expect([...roles].sort()).toEqual(
      [Role.ADMIN, Role.AIRLINE_MODERATOR, Role.REGISTERED_USER].sort(),
    );
  });
});

describe('FlightBookingsController FLT-26 cancellation', () => {
  const preview = jest.fn();
  const cancel = jest.fn();
  const controller = new FlightBookingsController(
    {} as FlightBookingsService,
    {} as FlightETicketService,
    {} as FlightBookingViewService,
    { preview, cancel } as unknown as FlightCancellationService,
  );
  const user: AuthenticatedUser = {
    userId: '665f1c2e8a1b2c3d4e5f6a7b',
    email: 'a@example.com',
    role: Role.REGISTERED_USER,
    jti: 'jti',
  };
  const params = Object.assign(new FlightBookingIdParamDto(), {
    id: '665f1c2e8a1b2c3d4e5f6a7c',
  });

  afterEach(() => jest.clearAllMocks());

  it('previews and cancels for the JWT user, never an owner from the request', async () => {
    preview.mockResolvedValue({ refundAmount: 1 });
    cancel.mockResolvedValue({ status: 'CANCELLED' });
    const dto = Object.assign(new CancelFlightBookingDto(), {
      confirm: true,
      reason: 'x',
    });

    await controller.previewCancellation(params, user);
    await controller.cancelBooking(params, dto, user);

    expect(preview).toHaveBeenCalledWith(user.userId, params.id);
    expect(cancel).toHaveBeenCalledWith(user.userId, params.id, dto);
  });

  it('is for registered users only (owner), on POST :id/cancel and GET :id/cancellation-preview', () => {
    for (const name of ['previewCancellation', 'cancelBooking']) {
      expect(Reflect.getMetadata(ROLES_KEY, handlers[name])).toEqual([
        Role.REGISTERED_USER,
      ]);
    }
    expect(
      Reflect.getMetadata(PATH_METADATA, handlers.previewCancellation),
    ).toBe(':id/cancellation-preview');
    expect(Reflect.getMetadata(PATH_METADATA, handlers.cancelBooking)).toBe(
      ':id/cancel',
    );
  });
});
