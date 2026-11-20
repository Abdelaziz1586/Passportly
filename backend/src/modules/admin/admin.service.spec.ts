import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { NotificationType, Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthService } from '../auth/auth.service';
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
