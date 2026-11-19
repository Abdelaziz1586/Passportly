import { ConflictException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AccountStatus, ProviderType, Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Airline } from '../flights/schemas/airline.schema';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { ModeratorAssignment } from '../users/schemas/moderator-assignment.schema';
import { User } from '../users/schemas/user.schema';
import { AdminService } from './admin.service';

describe('AdminService (ACC-13 create moderator)', () => {
  let service: AdminService;

  const mockUserModel = {
    exists: jest.fn(),
    create: jest.fn(),
    deleteOne: jest.fn(),
  };
  const mockModeratorAssignmentModel = {
    create: jest.fn(),
  };
  const mockAirlineModel = { findById: jest.fn() };
  const mockHotelModel = { findById: jest.fn() };
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
        { provide: getModelToken(User.name), useValue: mockUserModel },
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

  it('creates AIRLINE_MODERATOR user, unique ModeratorAssignment, and AuditLog', async () => {
    const airlineId = new Types.ObjectId('507f1f77bcf86cd799439055');
    const modId = new Types.ObjectId('507f1f77bcf86cd799439066');
    const assignmentId = new Types.ObjectId('507f1f77bcf86cd799439077');

    mockUserModel.exists.mockResolvedValue(null);
    mockAirlineModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: airlineId, name: 'EgyptAir' }),
      }),
    });
    mockUserModel.create.mockImplementation((doc: Record<string, unknown>) =>
      Promise.resolve({ _id: modId, ...doc }),
    );
    mockModeratorAssignmentModel.create.mockResolvedValue({
      _id: assignmentId,
      moderator: modId,
      providerType: ProviderType.AIRLINE,
      airline: airlineId,
      hotel: null,
      isActive: true,
    });

    const result = await service.createModerator(
      {
        email: 'Mod@EgyptAir.com',
        password: 'StrongPassword123!',
        firstName: 'Airline',
        lastName: 'Manager',
        role: Role.AIRLINE_MODERATOR,
        providerId: String(airlineId),
      },
      adminUser,
      '127.0.0.1',
    );

    expect(mockModeratorAssignmentModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        moderator: modId,
        providerType: ProviderType.AIRLINE,
        airline: airlineId,
        hotel: null,
        isActive: true,
      }),
    );
    expect(mockAuditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: adminUser.userId,
        action: 'MODERATOR_CREATED',
        targetType: 'User',
        targetId: String(modId),
      }),
    );
    expect(result).not.toHaveProperty('passwordHash');
    expect(result.status).toBe(AccountStatus.ACTIVE);
    expect(result.assignment).toEqual({
      id: String(assignmentId),
      providerType: ProviderType.AIRLINE,
      providerId: String(airlineId),
      providerName: 'EgyptAir',
      isActive: true,
    });
  });

  it('creates HOTEL_MODERATOR linked only to the target Hotel', async () => {
    const hotelId = new Types.ObjectId('507f1f77bcf86cd799439088');
    const modId = new Types.ObjectId('507f1f77bcf86cd799439089');
    const assignmentId = new Types.ObjectId('507f1f77bcf86cd799439090');

    mockUserModel.exists.mockResolvedValue(null);
    mockHotelModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: hotelId, name: 'Nile Ritz' }),
      }),
    });
    mockUserModel.create.mockImplementation((doc: Record<string, unknown>) =>
      Promise.resolve({ _id: modId, ...doc }),
    );
    mockModeratorAssignmentModel.create.mockResolvedValue({
      _id: assignmentId,
      moderator: modId,
      providerType: ProviderType.HOTEL,
      airline: null,
      hotel: hotelId,
      isActive: true,
    });

    const result = await service.createModerator(
      {
        email: 'hotel.mod@example.com',
        password: 'StrongPassword123!',
        firstName: 'Hotel',
        lastName: 'Manager',
        role: Role.HOTEL_MODERATOR,
        providerId: String(hotelId),
      },
      adminUser,
    );

    expect(result.assignment.providerType).toBe(ProviderType.HOTEL);
    expect(mockModeratorAssignmentModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        airline: null,
        hotel: hotelId,
      }),
    );
  });

  it('throws ConflictException on duplicate email and NotFoundException on missing provider', async () => {
    mockUserModel.exists.mockResolvedValue({ _id: 'existing' });
    await expect(
      service.createModerator(
        {
          email: 'dup@example.com',
          password: 'StrongPassword123!',
          firstName: 'A',
          lastName: 'B',
          role: Role.AIRLINE_MODERATOR,
          providerId: '507f1f77bcf86cd799439055',
        },
        adminUser,
      ),
    ).rejects.toThrow(ConflictException);

    mockUserModel.exists.mockResolvedValue(null);
    mockAirlineModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    await expect(
      service.createModerator(
        {
          email: 'new@example.com',
          password: 'StrongPassword123!',
          firstName: 'A',
          lastName: 'B',
          role: Role.AIRLINE_MODERATOR,
          providerId: '507f1f77bcf86cd799439055',
        },
        adminUser,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
