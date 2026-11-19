import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import {
  BookingStatus,
  NotificationType,
  ProviderType,
  Role,
} from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Airline } from '../flights/schemas/airline.schema';
import { FlightBooking } from '../flights/schemas/flight-booking.schema';
import { Flight } from '../flights/schemas/flight.schema';
import { HotelBooking } from '../hotels/schemas/hotel-booking.schema';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { ModeratorAssignment } from '../users/schemas/moderator-assignment.schema';
import { User } from '../users/schemas/user.schema';
import { AdminService } from './admin.service';

describe('AdminService (ACC-15 deactivate provider)', () => {
  let service: AdminService;

  const mockAirlineModel = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };
  const mockFlightModel = { distinct: jest.fn() };
  const mockFlightBookingModel = { find: jest.fn() };
  const mockHotelModel = { findById: jest.fn(), findByIdAndUpdate: jest.fn() };
  const mockHotelBookingModel = { find: jest.fn() };
  const mockModeratorAssignmentModel = { find: jest.fn() };
  const mockAuditLogsService = { log: jest.fn() };
  const mockNotificationsService = { createNotification: jest.fn() };

  const adminUser: AuthenticatedUser = {
    userId: '507f1f77bcf86cd799439001',
    email: 'admin@example.com',
    role: Role.ADMIN,
    jti: 'admin-jti',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getModelToken(User.name), useValue: {} },
        {
          provide: getModelToken(ModeratorAssignment.name),
          useValue: mockModeratorAssignmentModel,
        },
        { provide: getModelToken(Airline.name), useValue: mockAirlineModel },
        { provide: getModelToken(Flight.name), useValue: mockFlightModel },
        {
          provide: getModelToken(FlightBooking.name),
          useValue: mockFlightBookingModel,
        },
        { provide: getModelToken(Hotel.name), useValue: mockHotelModel },
        {
          provide: getModelToken(HotelBooking.name),
          useValue: mockHotelBookingModel,
        },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('deactivates airline, preserves confirmed bookings, notifies moderator and travelers, and logs audit', async () => {
    const airlineId = new Types.ObjectId('507f1f77bcf86cd799439022');
    const modId = new Types.ObjectId('507f1f77bcf86cd799439033');
    const flightId = new Types.ObjectId('507f1f77bcf86cd799439044');
    const bookingId = new Types.ObjectId('507f1f77bcf86cd799439055');
    const travelerId = new Types.ObjectId('507f1f77bcf86cd799439066');

    mockAirlineModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: airlineId,
          name: 'EgyptAir',
          isActive: true,
        }),
      }),
    });
    mockAirlineModel.findByIdAndUpdate.mockResolvedValue({});
    mockModeratorAssignmentModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ moderator: modId }]),
      }),
    });
    mockFlightModel.distinct.mockResolvedValue([flightId]);
    mockFlightBookingModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: bookingId,
            user: travelerId,
            bookingReference: 'FLT-1001',
            status: BookingStatus.CONFIRMED,
          },
        ]),
      }),
    });

    const result = await service.deactivateProvider(
      'airline',
      String(airlineId),
      adminUser,
      '127.0.0.1',
    );

    expect(mockFlightBookingModel.find).toHaveBeenCalled();
    expect(mockNotificationsService.createNotification).toHaveBeenCalledTimes(
      2,
    );
    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: modId,
        type: NotificationType.PROVIDER_DEACTIVATED,
      }),
    );
    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: travelerId,
        type: NotificationType.PROVIDER_DEACTIVATED,
      }),
    );
    expect(mockAuditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PROVIDER_DEACTIVATED',
        targetType: 'Airline',
        targetId: String(airlineId),
      }),
    );
    expect(result.isActive).toBe(false);
    expect(result.type).toBe(ProviderType.AIRLINE);
    expect(result.moderatorsNotified).toBe(1);
    expect(result.travelersNotified).toBe(1);
  });

  it('deactivates hotel and notifies affected hotel booking travelers', async () => {
    const hotelId = new Types.ObjectId('507f1f77bcf86cd799439077');
    const travelerId = new Types.ObjectId('507f1f77bcf86cd799439088');

    mockHotelModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: hotelId,
          name: 'Nile Ritz',
          isActive: true,
        }),
      }),
    });
    mockHotelModel.findByIdAndUpdate.mockResolvedValue({});
    mockModeratorAssignmentModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    });
    mockHotelBookingModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: new Types.ObjectId('507f1f77bcf86cd799439099'),
            user: travelerId,
            bookingReference: 'HTL-2001',
            status: BookingStatus.CONFIRMED,
          },
        ]),
      }),
    });

    const result = await service.deactivateProvider(
      'hotel',
      String(hotelId),
      adminUser,
    );

    expect(result.type).toBe(ProviderType.HOTEL);
    expect(result.travelersNotified).toBe(1);
    expect(mockAuditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PROVIDER_DEACTIVATED',
        targetType: 'Hotel',
      }),
    );
  });

  it('rejects invalid type/id, missing provider, and already deactivated provider', async () => {
    await expect(
      service.deactivateProvider('bus', '507f1f77bcf86cd799439022', adminUser),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.deactivateProvider('airline', 'bad-id', adminUser),
    ).rejects.toThrow(BadRequestException);

    mockAirlineModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    await expect(
      service.deactivateProvider(
        'airline',
        '507f1f77bcf86cd799439022',
        adminUser,
      ),
    ).rejects.toThrow(NotFoundException);

    mockAirlineModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId('507f1f77bcf86cd799439022'),
          name: 'EgyptAir',
          isActive: false,
        }),
      }),
    });
    await expect(
      service.deactivateProvider(
        'airline',
        '507f1f77bcf86cd799439022',
        adminUser,
      ),
    ).rejects.toThrow(ConflictException);
  });
});
