import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { NotificationType, ProviderType, Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Airline } from '../flights/schemas/airline.schema';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { ModeratorAssignment } from '../users/schemas/moderator-assignment.schema';
import { User } from '../users/schemas/user.schema';
import { AdminService } from './admin.service';

describe('AdminService (ACC-15 reactivate provider)', () => {
  let service: AdminService;

  const mockAirlineModel = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };
  const mockHotelModel = { findById: jest.fn(), findByIdAndUpdate: jest.fn() };
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
        { provide: getModelToken(Hotel.name), useValue: mockHotelModel },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('reactivates deactivated hotel, notifies assigned moderator, and writes audit log', async () => {
    const hotelId = new Types.ObjectId('507f1f77bcf86cd799439022');
    const modId = new Types.ObjectId('507f1f77bcf86cd799439033');

    mockHotelModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: hotelId,
          name: 'Nile Ritz',
          isActive: false,
        }),
      }),
    });
    mockHotelModel.findByIdAndUpdate.mockResolvedValue({});
    mockModeratorAssignmentModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ moderator: modId }]),
      }),
    });

    const result = await service.reactivateProvider(
      'hotel',
      String(hotelId),
      adminUser,
      '127.0.0.1',
    );

    expect(mockHotelModel.findByIdAndUpdate).toHaveBeenCalledWith(
      hotelId,
      {
        $set: { isActive: true },
        $unset: { deactivatedAt: 1, deactivatedBy: 1 },
      },
      { returnDocument: 'after' },
    );
    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: modId,
        type: NotificationType.PROVIDER_REACTIVATED,
        relatedEntityType: 'Hotel',
        relatedEntityId: hotelId,
      }),
    );
    expect(mockAuditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PROVIDER_REACTIVATED',
        targetType: 'Hotel',
        targetId: String(hotelId),
      }),
    );
    expect(result.isActive).toBe(true);
    expect(result.type).toBe(ProviderType.HOTEL);
    expect(result.moderatorsNotified).toBe(1);
  });

  it('throws BadRequestException, NotFoundException, and ConflictException appropriately', async () => {
    await expect(
      service.reactivateProvider(
        'train',
        '507f1f77bcf86cd799439022',
        adminUser,
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.reactivateProvider('airline', 'bad-id', adminUser),
    ).rejects.toThrow(BadRequestException);

    mockAirlineModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    await expect(
      service.reactivateProvider(
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
          isActive: true,
        }),
      }),
    });
    await expect(
      service.reactivateProvider(
        'airline',
        '507f1f77bcf86cd799439022',
        adminUser,
      ),
    ).rejects.toThrow(ConflictException);
  });
});
