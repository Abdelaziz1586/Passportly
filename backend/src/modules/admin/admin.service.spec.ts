import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import {
  NotificationType,
  ReportStatus,
  ReportTargetType,
  Role,
} from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { BlogPost } from '../blog/schemas/blog-post.schema';
import { Comment } from '../blog/schemas/comment.schema';
import { Like } from '../blog/schemas/like.schema';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { Review } from '../hotels/schemas/review.schema';
import { Activity } from '../itineraries/schemas/activity.schema';
import { BudgetEntry } from '../itineraries/schemas/budget-entry.schema';
import { Itinerary } from '../itineraries/schemas/itinerary.schema';
import { TransportCost } from '../itineraries/schemas/transport-cost.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { Report } from '../reports/schemas/report.schema';
import { ModeratorAssignment } from '../users/schemas/moderator-assignment.schema';
import { User } from '../users/schemas/user.schema';
import { AdminService } from './admin.service';

describe('AdminService (GEN-10 resolve report)', () => {
  let service: AdminService;

  const mockReportModel = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };
  const mockBlogPostModel = {
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    updateOne: jest.fn(),
  };
  const mockCommentModel = {
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    deleteMany: jest.fn(),
  };
  const mockLikeModel = { deleteMany: jest.fn() };
  const mockItineraryModel = {
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
  };
  const mockActivityModel = { deleteMany: jest.fn() };
  const mockBudgetEntryModel = { deleteMany: jest.fn() };
  const mockTransportCostModel = { deleteMany: jest.fn() };
  const mockReviewModel = {
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    find: jest.fn(),
  };
  const mockHotelModel = { updateOne: jest.fn() };
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
        { provide: getModelToken(ModeratorAssignment.name), useValue: {} },
        { provide: getModelToken(Report.name), useValue: mockReportModel },
        { provide: getModelToken(BlogPost.name), useValue: mockBlogPostModel },
        { provide: getModelToken(Comment.name), useValue: mockCommentModel },
        { provide: getModelToken(Like.name), useValue: mockLikeModel },
        {
          provide: getModelToken(Itinerary.name),
          useValue: mockItineraryModel,
        },
        { provide: getModelToken(Activity.name), useValue: mockActivityModel },
        {
          provide: getModelToken(BudgetEntry.name),
          useValue: mockBudgetEntryModel,
        },
        {
          provide: getModelToken(TransportCost.name),
          useValue: mockTransportCostModel,
        },
        { provide: getModelToken(Review.name), useValue: mockReviewModel },
        { provide: getModelToken(Hotel.name), useValue: mockHotelModel },
        { provide: AuditLogsService, useValue: mockAuditLogsService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('hides blog post on CONTENT_HIDDEN, notifies author and reporter, and writes audit log', async () => {
    const reportId = new Types.ObjectId('507f1f77bcf86cd799439055');
    const reporterId = new Types.ObjectId('507f1f77bcf86cd799439011');
    const authorId = new Types.ObjectId('507f1f77bcf86cd799439022');
    const postId = new Types.ObjectId('507f1f77bcf86cd799439033');

    mockReportModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: reportId,
        reporter: reporterId,
        targetType: ReportTargetType.BLOG_POST,
        targetId: postId,
        reason: 'Spam',
        status: ReportStatus.PENDING,
      }),
    });
    mockBlogPostModel.findByIdAndUpdate.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: postId, author: authorId }),
      }),
    });
    mockReportModel.findByIdAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: reportId,
        reporter: reporterId,
        targetType: ReportTargetType.BLOG_POST,
        targetId: postId,
        reason: 'Spam',
        status: ReportStatus.CONTENT_HIDDEN,
      }),
    });

    const result = await service.resolveReport(
      String(reportId),
      { status: ReportStatus.CONTENT_HIDDEN, resolutionNotes: 'Hidden' },
      adminUser,
      '127.0.0.1',
    );

    expect(mockBlogPostModel.findByIdAndUpdate).toHaveBeenCalledWith(
      postId,
      { $set: { isHidden: true } },
      { returnDocument: 'after' },
    );
    expect(mockNotificationsService.createNotification).toHaveBeenCalledTimes(
      2,
    );
    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: authorId,
        type: NotificationType.MODERATION_ACTION,
      }),
    );
    expect(mockAuditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'REPORT_RESOLVED',
        targetType: 'Report',
        targetId: String(reportId),
      }),
    );
    expect(result.status).toBe(ReportStatus.CONTENT_HIDDEN);
  });

  it('deletes review and recalculates hotel rating on CONTENT_DELETED', async () => {
    const reportId = new Types.ObjectId('507f1f77bcf86cd799439055');
    const reporterId = new Types.ObjectId('507f1f77bcf86cd799439011');
    const authorId = new Types.ObjectId('507f1f77bcf86cd799439022');
    const reviewId = new Types.ObjectId('507f1f77bcf86cd799439044');
    const hotelId = new Types.ObjectId('507f1f77bcf86cd799439066');

    mockReportModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: reportId,
        reporter: reporterId,
        targetType: ReportTargetType.REVIEW,
        targetId: reviewId,
        reason: 'Abusive',
        status: ReportStatus.PENDING,
      }),
    });
    mockReviewModel.findByIdAndDelete.mockReturnValue({
      lean: jest
        .fn()
        .mockResolvedValue({ _id: reviewId, user: authorId, hotel: hotelId }),
    });
    mockReviewModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ rating: 4 }, { rating: 5 }]),
      }),
    });
    mockHotelModel.updateOne.mockResolvedValue({});
    mockReportModel.findByIdAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: reportId,
        reporter: reporterId,
        targetType: ReportTargetType.REVIEW,
        targetId: reviewId,
        reason: 'Abusive',
        status: ReportStatus.CONTENT_DELETED,
      }),
    });

    const result = await service.resolveReport(
      String(reportId),
      { status: ReportStatus.CONTENT_DELETED },
      adminUser,
    );

    expect(mockHotelModel.updateOne).toHaveBeenCalledWith(
      { _id: hotelId },
      { $set: { averageRating: 4.5, reviewCount: 2 } },
    );
    expect(result.status).toBe(ReportStatus.CONTENT_DELETED);
  });

  it('rejects invalid IDs, missing reports, and already-resolved reports', async () => {
    await expect(
      service.resolveReport(
        'bad-id',
        { status: ReportStatus.DISMISSED },
        adminUser,
      ),
    ).rejects.toThrow(BadRequestException);

    mockReportModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.resolveReport(
        '507f1f77bcf86cd799439055',
        { status: ReportStatus.DISMISSED },
        adminUser,
      ),
    ).rejects.toThrow(NotFoundException);

    mockReportModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId('507f1f77bcf86cd799439055'),
        status: ReportStatus.DISMISSED,
      }),
    });
    await expect(
      service.resolveReport(
        '507f1f77bcf86cd799439055',
        { status: ReportStatus.CONTENT_HIDDEN },
        adminUser,
      ),
    ).rejects.toThrow(ConflictException);
  });
});
