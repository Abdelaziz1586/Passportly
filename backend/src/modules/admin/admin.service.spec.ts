import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import {
  AccountStatus,
  ReportStatus,
  ReportTargetType,
  Role,
} from '../../common/enums';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Report } from '../reports/schemas/report.schema';
import { ModeratorAssignment } from '../users/schemas/moderator-assignment.schema';
import { User } from '../users/schemas/user.schema';
import { AdminService } from './admin.service';

describe('AdminService (GEN-09/GEN-10 list reports)', () => {
  let service: AdminService;

  const mockLean = jest.fn();
  const mockLimit = jest.fn();
  const mockSkip = jest.fn();
  const mockSort = jest.fn();
  const mockPopulate2 = jest.fn();
  const mockPopulate1 = jest.fn();

  const mockReportModel = {
    find: jest.fn(),
    countDocuments: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockReportModel.find.mockReturnValue({ populate: mockPopulate1 });
    mockPopulate1.mockReturnValue({ populate: mockPopulate2 });
    mockPopulate2.mockReturnValue({ sort: mockSort });
    mockSort.mockReturnValue({ skip: mockSkip });
    mockSkip.mockReturnValue({ limit: mockLimit });
    mockLimit.mockReturnValue({ lean: mockLean });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getModelToken(User.name), useValue: {} },
        { provide: getModelToken(ModeratorAssignment.name), useValue: {} },
        { provide: getModelToken(Report.name), useValue: mockReportModel },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        {
          provide: NotificationsService,
          useValue: { createNotification: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('filters reports by status and targetType with pagination and reporter info', async () => {
    const reportId = new Types.ObjectId('507f1f77bcf86cd799439055');
    const reporterId = new Types.ObjectId('507f1f77bcf86cd799439011');
    const targetId = new Types.ObjectId('507f1f77bcf86cd799439022');

    mockLean.mockResolvedValue([
      {
        _id: reportId,
        reporter: {
          _id: reporterId,
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
          role: Role.REGISTERED_USER,
          status: AccountStatus.ACTIVE,
        },
        targetType: ReportTargetType.BLOG_POST,
        targetId,
        reason: 'Spam',
        status: ReportStatus.PENDING,
        reviewedBy: null,
      },
    ]);
    mockReportModel.countDocuments.mockResolvedValue(1);

    const result = await service.listReports({
      status: ReportStatus.PENDING,
      targetType: ReportTargetType.BLOG_POST,
      page: 1,
      limit: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(mockReportModel.find).toHaveBeenCalledWith({
      status: ReportStatus.PENDING,
      targetType: ReportTargetType.BLOG_POST,
    });
    expect(result).toEqual({
      data: [
        {
          id: String(reportId),
          reporter: {
            id: String(reporterId),
            firstName: 'Jane',
            lastName: 'Doe',
            email: 'jane@example.com',
            role: Role.REGISTERED_USER,
            status: AccountStatus.ACTIVE,
          },
          targetType: ReportTargetType.BLOG_POST,
          targetId: String(targetId),
          reason: 'Spam',
          status: ReportStatus.PENDING,
          reviewedBy: null,
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });
});
