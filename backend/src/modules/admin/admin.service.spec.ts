import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AccountStatus, NotificationType, Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ModeratorAssignment } from '../users/schemas/moderator-assignment.schema';
import { User } from '../users/schemas/user.schema';
import { AdminService } from './admin.service';

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
