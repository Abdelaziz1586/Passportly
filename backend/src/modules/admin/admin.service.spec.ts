import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { BookingStatus, BookingType } from '../../common/enums';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { FlightBooking } from '../flights/schemas/flight-booking.schema';
import { HotelBooking } from '../hotels/schemas/hotel-booking.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { ModeratorAssignment } from '../users/schemas/moderator-assignment.schema';
import { User } from '../users/schemas/user.schema';
import { AdminService } from './admin.service';

describe('AdminService (ACC-17 admin bookings)', () => {
  let service: AdminService;

  const mockFlightBookingModel = {
    find: jest.fn(),
    countDocuments: jest.fn(),
  };
  const mockHotelBookingModel = {
    find: jest.fn(),
    countDocuments: jest.fn(),
  };

  function makeChain(result: unknown[]) {
    const lean = jest.fn().mockResolvedValue(result);
    const limit = jest.fn().mockReturnValue({ lean });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip, limit });
    const populate2 = jest.fn().mockReturnValue({ sort });
    const populate1 = jest.fn().mockReturnValue({ populate: populate2 });
    return { populate: populate1, sort, skip, limit, lean };
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getModelToken(User.name), useValue: {} },
        { provide: getModelToken(ModeratorAssignment.name), useValue: {} },
        {
          provide: getModelToken(FlightBooking.name),
          useValue: mockFlightBookingModel,
        },
        {
          provide: getModelToken(HotelBooking.name),
          useValue: mockHotelBookingModel,
        },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        {
          provide: NotificationsService,
          useValue: { createNotification: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('merges, sorts, and paginates both flight and hotel bookings when bookingType is omitted', async () => {
    const userId = new Types.ObjectId('507f1f77bcf86cd799439011');
    const older = new Date('2026-11-18T10:00:00.000Z');
    const newer = new Date('2026-11-19T12:00:00.000Z');

    const flightChain = makeChain([
      {
        _id: new Types.ObjectId('507f1f77bcf86cd799439021'),
        bookingReference: 'FLT-100',
        user: {
          _id: userId,
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
        },
        tripType: 'ONE_WAY',
        legs: [],
        passengerCounts: { totalSeatsRequired: 1 },
        totalPrice: 300,
        currency: 'USD',
        status: BookingStatus.CONFIRMED,
        createdAt: older,
      },
    ]);
    const hotelChain = makeChain([
      {
        _id: new Types.ObjectId('507f1f77bcf86cd799439022'),
        bookingReference: 'HTL-200',
        user: {
          _id: userId,
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
        },
        hotel: { _id: new Types.ObjectId(), name: 'Nile Ritz' },
        checkInDate: newer,
        checkOutDate: newer,
        nights: 2,
        guestCount: 2,
        rooms: [],
        totalPrice: 500,
        currency: 'USD',
        status: BookingStatus.CONFIRMED,
        createdAt: newer,
      },
    ]);

    mockFlightBookingModel.find.mockReturnValue({
      populate: flightChain.populate,
    });
    mockHotelBookingModel.find.mockReturnValue({
      populate: hotelChain.populate,
    });
    mockFlightBookingModel.countDocuments.mockResolvedValue(1);
    mockHotelBookingModel.countDocuments.mockResolvedValue(1);

    const result = await service.listPlatformBookings({
      status: BookingStatus.CONFIRMED,
      userId: String(userId),
      page: 1,
      limit: 10,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].bookingType).toBe(BookingType.HOTEL);
    expect(result.data[1].bookingType).toBe(BookingType.FLIGHT);
  });

  it('queries only FlightBooking when bookingType=flight', async () => {
    const flightChain = makeChain([]);
    mockFlightBookingModel.find.mockReturnValue({
      populate: flightChain.populate,
    });
    mockFlightBookingModel.countDocuments.mockResolvedValue(0);

    const result = await service.listPlatformBookings({
      bookingType: BookingType.FLIGHT,
      page: 1,
      limit: 20,
    });

    expect(mockHotelBookingModel.find).not.toHaveBeenCalled();
    expect(result.total).toBe(0);
  });

  it('rejects fromDate > toDate with BadRequestException', async () => {
    await expect(
      service.listPlatformBookings({
        fromDate: new Date('2026-11-20T00:00:00.000Z'),
        toDate: new Date('2026-11-10T00:00:00.000Z'),
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
