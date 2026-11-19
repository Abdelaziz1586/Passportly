import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { Role } from '../../common/enums';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditLog } from '../audit-logs/schemas/audit-log.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { ModeratorAssignment } from '../users/schemas/moderator-assignment.schema';
import { User } from '../users/schemas/user.schema';
import { AdminService } from './admin.service';

describe('AdminService (GEN-07 audit logs)', () => {
  let service: AdminService;

  const mockLean = jest.fn();
  const mockLimit = jest.fn();
  const mockSkip = jest.fn();
  const mockSort = jest.fn();
  const mockPopulate = jest.fn();

  const mockAuditLogModel = {
    find: jest.fn(),
    countDocuments: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuditLogModel.find.mockReturnValue({ populate: mockPopulate });
    mockPopulate.mockReturnValue({ sort: mockSort });
    mockSort.mockReturnValue({ skip: mockSkip });
    mockSkip.mockReturnValue({ limit: mockLimit });
    mockLimit.mockReturnValue({ lean: mockLean });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getModelToken(User.name), useValue: {} },
        { provide: getModelToken(ModeratorAssignment.name), useValue: {} },
        { provide: getModelToken(AuditLog.name), useValue: mockAuditLogModel },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        {
          provide: NotificationsService,
          useValue: { createNotification: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('filters audit logs by actor, action, targetType, and date range with sorting and pagination', async () => {
    const actorId = new Types.ObjectId('507f1f77bcf86cd799439001');
    const logId = new Types.ObjectId('507f1f77bcf86cd799439088');
    const createdAt = new Date('2026-11-19T12:00:00.000Z');

    mockLean.mockResolvedValue([
      {
        _id: logId,
        actor: {
          _id: actorId,
          firstName: 'Platform',
          lastName: 'Administrator',
          email: 'admin@travelplatform.local',
          role: Role.ADMIN,
        },
        actorRole: 'ADMIN',
        action: 'ACCOUNT_SUSPENDED',
        targetType: 'User',
        targetId: '507f1f77bcf86cd799439022',
        details: { reason: 'Spam' },
        ipAddress: '127.0.0.1',
        createdAt,
      },
    ]);
    mockAuditLogModel.countDocuments.mockResolvedValue(1);

    const fromDate = new Date('2026-11-01T00:00:00.000Z');
    const toDate = new Date('2026-11-19T23:59:59.999Z');

    const result = await service.listAuditLogs({
      actor: String(actorId),
      action: 'ACCOUNT_SUSPENDED',
      targetType: 'User',
      fromDate,
      toDate,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      page: 1,
      limit: 20,
    });

    expect(mockAuditLogModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: actorId,
        action: expect.any(RegExp) as unknown,
        targetType: expect.any(RegExp) as unknown,
        createdAt: { $gte: fromDate, $lte: toDate },
      }),
    );
    expect(result).toEqual({
      data: [
        {
          id: String(logId),
          actor: {
            id: String(actorId),
            firstName: 'Platform',
            lastName: 'Administrator',
            email: 'admin@travelplatform.local',
            role: Role.ADMIN,
          },
          actorRole: 'ADMIN',
          action: 'ACCOUNT_SUSPENDED',
          targetType: 'User',
          targetId: '507f1f77bcf86cd799439022',
          details: { reason: 'Spam' },
          ipAddress: '127.0.0.1',
          createdAt,
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  it('rejects fromDate > toDate with BadRequestException', async () => {
    await expect(
      service.listAuditLogs({
        fromDate: new Date('2026-11-20T00:00:00.000Z'),
        toDate: new Date('2026-11-01T00:00:00.000Z'),
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
