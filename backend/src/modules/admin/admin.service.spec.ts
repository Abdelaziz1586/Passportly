import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import {
  AccountStatus,
  BookingStatus,
  NotificationType,
  ProviderType,
  Role,
} from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthService } from '../auth/auth.service';
import { Airline } from '../flights/schemas/airline.schema';
import { FlightBooking } from '../flights/schemas/flight-booking.schema';
import { Flight } from '../flights/schemas/flight.schema';
import { HotelBooking } from '../hotels/schemas/hotel-booking.schema';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { ModeratorAssignment } from '../users/schemas/moderator-assignment.schema';
import { User } from '../users/schemas/user.schema';
import { AdminService } from './admin.service';

describe('AdminService (ACC-07a admin reset password)', () => {
  let service: AdminService;

  const mockUserModel = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };
  const mockModeratorAssignmentModel = {};
  const mockAuditLogsService = { log: jest.fn() };
  const mockNotificationsService = { createNotification: jest.fn() };
  const mockAuthService = { revokeUserSessions: jest.fn() };

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
        { provide: getModelToken(Airline.name), useValue: {} },
        { provide: getModelToken(Hotel.name), useValue: {} },
        { provide: getModelToken(Flight.name), useValue: {} },
        { provide: getModelToken(FlightBooking.name), useValue: {} },
        { provide: getModelToken(HotelBooking.name), useValue: {} },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('sets hashed temporary password, mustChangePassword=true, revokes sessions, notifies, and logs audit', async () => {
    const targetId = new Types.ObjectId('507f1f77bcf86cd799439022');
    mockUserModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: targetId,
        email: 'user@example.com',
      }),
    });
    mockUserModel.findByIdAndUpdate.mockResolvedValue({});
    mockAuthService.revokeUserSessions.mockResolvedValue(3);

    const result = await service.resetUserPassword(
      String(targetId),
      { temporaryPassword: 'TempPassword123!' },
      adminUser,
      '127.0.0.1',
    );

    const updateArgs = mockUserModel.findByIdAndUpdate.mock.calls[0] as [
      Types.ObjectId,
      { $set: { passwordHash: string; mustChangePassword: boolean } },
    ];
    expect(updateArgs[1].$set.mustChangePassword).toBe(true);
    expect(
      await bcrypt.compare('TempPassword123!', updateArgs[1].$set.passwordHash),
    ).toBe(true);
    expect(mockAuthService.revokeUserSessions).toHaveBeenCalledWith(targetId);
    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: targetId,
        type: NotificationType.SYSTEM,
      }),
    );
    expect(mockAuditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: adminUser.userId,
        action: 'ADMIN_PASSWORD_RESET',
        targetType: 'User',
        targetId: String(targetId),
        ipAddress: '127.0.0.1',
      }),
    );
    expect(result).toEqual({
      message: 'Temporary password set successfully',
      userId: String(targetId),
      mustChangePassword: true,
      sessionsRevoked: 3,
    });
  });

  it('rejects invalid userId and self-reset attempts', async () => {
    await expect(
      service.resetUserPassword(
        'bad-id',
        { temporaryPassword: 'TempPassword123!' },
        adminUser,
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.resetUserPassword(
        adminUser.userId,
        { temporaryPassword: 'TempPassword123!' },
        adminUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when target user does not exist', async () => {
    mockUserModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.resetUserPassword(
        '507f1f77bcf86cd799439022',
        { temporaryPassword: 'TempPassword123!' },
        adminUser,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

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
        { provide: getModelToken(Flight.name), useValue: {} },
        { provide: getModelToken(FlightBooking.name), useValue: {} },
        { provide: getModelToken(HotelBooking.name), useValue: {} },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: AuthService, useValue: { revokeUserSessions: jest.fn() } },
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

describe('AdminService (ACC-14 list accounts)', () => {
  let service: AdminService;

  const mockUserSelect = jest.fn();
  const mockUserSort = jest.fn();
  const mockUserSkip = jest.fn();
  const mockUserLimit = jest.fn();
  const mockUserLean = jest.fn();

  const mockUserModel = {
    find: jest.fn(),
    countDocuments: jest.fn(),
  };

  const mockAssignPopulate1 = jest.fn();
  const mockAssignPopulate2 = jest.fn();
  const mockAssignLean = jest.fn();

  const mockModeratorAssignmentModel = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockUserModel.find.mockReturnValue({ select: mockUserSelect });
    mockUserSelect.mockReturnValue({ sort: mockUserSort });
    mockUserSort.mockReturnValue({ skip: mockUserSkip });
    mockUserSkip.mockReturnValue({ limit: mockUserLimit });
    mockUserLimit.mockReturnValue({ lean: mockUserLean });

    mockModeratorAssignmentModel.find.mockReturnValue({
      populate: mockAssignPopulate1,
    });
    mockAssignPopulate1.mockReturnValue({ populate: mockAssignPopulate2 });
    mockAssignPopulate2.mockReturnValue({ lean: mockAssignLean });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
        {
          provide: getModelToken(ModeratorAssignment.name),
          useValue: mockModeratorAssignmentModel,
        },
        { provide: getModelToken(Airline.name), useValue: {} },
        { provide: getModelToken(Hotel.name), useValue: {} },
        { provide: AuthService, useValue: { revokeUserSessions: jest.fn() } },
        { provide: getModelToken(Flight.name), useValue: {} },
        { provide: getModelToken(FlightBooking.name), useValue: {} },
        { provide: getModelToken(HotelBooking.name), useValue: {} },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        {
          provide: NotificationsService,
          useValue: { createNotification: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('filters by role, status, search, sorts, paginates, and attaches moderator assignment info', async () => {
    const modId = new Types.ObjectId('507f1f77bcf86cd799439022');
    const airlineId = new Types.ObjectId('507f1f77bcf86cd799439033');
    const assignmentId = new Types.ObjectId('507f1f77bcf86cd799439044');

    mockUserLean.mockResolvedValue([
      {
        _id: modId,
        email: 'mod@egyptair.com',
        firstName: 'Airline',
        lastName: 'Moderator',
        role: Role.AIRLINE_MODERATOR,
        status: AccountStatus.ACTIVE,
        isEmailVerified: true,
        mustChangePassword: false,
      },
    ]);
    mockUserModel.countDocuments.mockResolvedValue(1);
    mockAssignLean.mockResolvedValue([
      {
        _id: assignmentId,
        moderator: modId,
        providerType: ProviderType.AIRLINE,
        airline: { _id: airlineId, name: 'EgyptAir', isActive: true },
        hotel: null,
        isActive: true,
      },
    ]);

    const result = await service.listAccounts({
      role: Role.AIRLINE_MODERATOR,
      status: AccountStatus.ACTIVE,
      search: 'Airline Mod',
      sortBy: 'email',
      sortOrder: 'asc',
      page: 1,
      limit: 10,
    });

    expect(mockUserModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        role: Role.AIRLINE_MODERATOR,
        status: AccountStatus.ACTIVE,
        $and: expect.any(Array) as unknown,
      }),
    );
    expect(mockUserSort).toHaveBeenCalledWith({ email: 1, _id: 1 });
    expect(mockModeratorAssignmentModel.find).toHaveBeenCalledWith({
      moderator: { $in: [modId] },
    });
    expect(result).toEqual({
      data: [
        {
          id: String(modId),
          email: 'mod@egyptair.com',
          firstName: 'Airline',
          lastName: 'Moderator',
          role: Role.AIRLINE_MODERATOR,
          status: AccountStatus.ACTIVE,
          isEmailVerified: true,
          mustChangePassword: false,
          assignment: {
            id: String(assignmentId),
            providerType: ProviderType.AIRLINE,
            providerId: String(airlineId),
            providerName: 'EgyptAir',
            isActive: true,
            providerIsActive: true,
          },
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
    });
  });

  it('skips ModeratorAssignment lookup when no moderators are in the page', async () => {
    const userId = new Types.ObjectId('507f1f77bcf86cd799439011');
    mockUserLean.mockResolvedValue([
      {
        _id: userId,
        email: 'traveler@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        role: Role.REGISTERED_USER,
        status: AccountStatus.ACTIVE,
        isEmailVerified: true,
      },
    ]);
    mockUserModel.countDocuments.mockResolvedValue(1);

    const result = await service.listAccounts({});

    expect(mockModeratorAssignmentModel.find).not.toHaveBeenCalled();
    expect(result.data[0].assignment).toBeUndefined();
  });
});

describe('AdminService (ACC-15/ACC-16 suspend account)', () => {
  let service: AdminService;

  const mockUserModel = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };
  const mockAuthService = { revokeUserSessions: jest.fn() };
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
        { provide: getModelToken(ModeratorAssignment.name), useValue: {} },
        { provide: getModelToken(Airline.name), useValue: {} },
        { provide: getModelToken(Hotel.name), useValue: {} },
        { provide: getModelToken(Flight.name), useValue: {} },
        { provide: getModelToken(FlightBooking.name), useValue: {} },
        { provide: getModelToken(HotelBooking.name), useValue: {} },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('suspends account, revokes sessions, sends notification, and writes audit log', async () => {
    const targetId = new Types.ObjectId('507f1f77bcf86cd799439022');
    const suspendedAt = new Date('2026-11-19T14:00:00.000Z');

    mockUserModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: targetId,
        email: 'user@example.com',
        role: Role.REGISTERED_USER,
        status: AccountStatus.ACTIVE,
      }),
    });
    mockUserModel.findByIdAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: targetId,
        email: 'user@example.com',
        role: Role.REGISTERED_USER,
        status: AccountStatus.SUSPENDED,
        suspendedAt,
        suspendedReason: 'Policy violation',
      }),
    });
    mockAuthService.revokeUserSessions.mockResolvedValue(2);

    const result = await service.suspendAccount(
      String(targetId),
      { reason: 'Policy violation' },
      adminUser,
      '127.0.0.1',
    );

    expect(result.status).toBe(AccountStatus.SUSPENDED);
    expect(result.sessionsRevoked).toBe(2);
    expect(mockAuthService.revokeUserSessions).toHaveBeenCalledWith(targetId);
    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: targetId,
        type: NotificationType.ACCOUNT_SUSPENDED,
      }),
    );
    expect(mockAuditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: adminUser.userId,
        action: 'ACCOUNT_SUSPENDED',
        targetType: 'User',
        targetId: String(targetId),
      }),
    );
  });

  it('prevents self-suspension and rejects invalid IDs', async () => {
    await expect(
      service.suspendAccount(adminUser.userId, {}, adminUser),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.suspendAccount('bad-id', {}, adminUser),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException for missing account and ConflictException if already suspended', async () => {
    mockUserModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.suspendAccount('507f1f77bcf86cd799439022', {}, adminUser),
    ).rejects.toThrow(NotFoundException);

    mockUserModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId('507f1f77bcf86cd799439022'),
        status: AccountStatus.SUSPENDED,
      }),
    });
    await expect(
      service.suspendAccount('507f1f77bcf86cd799439022', {}, adminUser),
    ).rejects.toThrow(ConflictException);
  });
});

describe('AdminService (ACC-15/ACC-16 reactivate account)', () => {
  let service: AdminService;

  const mockUserModel = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };
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
        { provide: getModelToken(ModeratorAssignment.name), useValue: {} },
        { provide: getModelToken(Airline.name), useValue: {} },
        { provide: getModelToken(Hotel.name), useValue: {} },
        { provide: AuthService, useValue: { revokeUserSessions: jest.fn() } },
        { provide: getModelToken(Flight.name), useValue: {} },
        { provide: getModelToken(FlightBooking.name), useValue: {} },
        { provide: getModelToken(HotelBooking.name), useValue: {} },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('reactivates suspended account, clears lockout/suspension flags, notifies, and writes audit log', async () => {
    const targetId = new Types.ObjectId('507f1f77bcf86cd799439022');
    mockUserModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: targetId,
        email: 'user@example.com',
        role: Role.REGISTERED_USER,
        status: AccountStatus.SUSPENDED,
        failedLoginAttempts: 5,
        lockoutUntil: new Date('2026-11-19T15:00:00.000Z'),
      }),
    });
    mockUserModel.findByIdAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: targetId,
        email: 'user@example.com',
        role: Role.REGISTERED_USER,
        status: AccountStatus.ACTIVE,
        failedLoginAttempts: 0,
      }),
    });

    const result = await service.reactivateAccount(
      String(targetId),
      adminUser,
      '127.0.0.1',
    );

    expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
      targetId,
      {
        $set: {
          status: AccountStatus.ACTIVE,
          failedLoginAttempts: 0,
          lockoutUntil: null,
        },
        $unset: {
          suspendedAt: 1,
          suspendedReason: 1,
          deactivatedAt: 1,
        },
      },
      { returnDocument: 'after' },
    );
    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: targetId,
        type: NotificationType.ACCOUNT_REACTIVATED,
      }),
    );
    expect(mockAuditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: adminUser.userId,
        action: 'ACCOUNT_REACTIVATED',
        targetType: 'User',
        targetId: String(targetId),
      }),
    );
    expect(result.status).toBe(AccountStatus.ACTIVE);
    expect(result.failedLoginAttempts).toBe(0);
  });

  it('also clears lockout on an ACTIVE account with active lockout flags', async () => {
    const targetId = new Types.ObjectId('507f1f77bcf86cd799439022');
    mockUserModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: targetId,
        email: 'locked@example.com',
        role: Role.REGISTERED_USER,
        status: AccountStatus.ACTIVE,
        failedLoginAttempts: 5,
        lockoutUntil: new Date('2026-11-20T00:00:00.000Z'),
      }),
    });
    mockUserModel.findByIdAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: targetId,
        email: 'locked@example.com',
        role: Role.REGISTERED_USER,
        status: AccountStatus.ACTIVE,
        failedLoginAttempts: 0,
      }),
    });

    const result = await service.reactivateAccount(String(targetId), adminUser);
    expect(result.status).toBe(AccountStatus.ACTIVE);
    expect(result.failedLoginAttempts).toBe(0);
  });

  it('throws BadRequestException, NotFoundException, and ConflictException appropriately', async () => {
    await expect(
      service.reactivateAccount('bad-id', adminUser),
    ).rejects.toThrow(BadRequestException);

    mockUserModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.reactivateAccount('507f1f77bcf86cd799439022', adminUser),
    ).rejects.toThrow(NotFoundException);

    mockUserModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId('507f1f77bcf86cd799439022'),
        status: AccountStatus.ACTIVE,
        failedLoginAttempts: 0,
        lockoutUntil: null,
      }),
    });
    await expect(
      service.reactivateAccount('507f1f77bcf86cd799439022', adminUser),
    ).rejects.toThrow(ConflictException);
  });
});

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
        { provide: AuthService, useValue: { revokeUserSessions: jest.fn() } },
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
        { provide: getModelToken(Flight.name), useValue: {} },
        { provide: getModelToken(FlightBooking.name), useValue: {} },
        { provide: getModelToken(HotelBooking.name), useValue: {} },
        { provide: AuthService, useValue: { revokeUserSessions: jest.fn() } },
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
