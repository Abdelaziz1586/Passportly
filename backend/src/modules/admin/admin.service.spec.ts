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
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ModeratorAssignment } from '../users/schemas/moderator-assignment.schema';
import { User } from '../users/schemas/user.schema';
import { AdminService } from './admin.service';

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
