import { BadRequestException, NotFoundException } from '@nestjs/common';
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

describe('AdminService (GEN-10 delete content)', () => {
  let service: AdminService;

  const mockReportModel = { updateMany: jest.fn() };
  const mockBlogPostModel = {
    findByIdAndDelete: jest.fn(),
    updateOne: jest.fn(),
  };
  const mockCommentModel = {
    findByIdAndDelete: jest.fn(),
    deleteMany: jest.fn(),
  };
  const mockLikeModel = { deleteMany: jest.fn() };
  const mockItineraryModel = { findByIdAndDelete: jest.fn() };
  const mockActivityModel = { deleteMany: jest.fn() };
  const mockBudgetEntryModel = { deleteMany: jest.fn() };
  const mockTransportCostModel = { deleteMany: jest.fn() };
  const mockReviewModel = { findByIdAndDelete: jest.fn(), find: jest.fn() };
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

  it('deletes blog_post and child comments/likes, resolves pending reports, notifies owner, and logs audit', async () => {
    const postId = new Types.ObjectId('507f1f77bcf86cd799439022');
    const authorId = new Types.ObjectId('507f1f77bcf86cd799439011');

    mockBlogPostModel.findByIdAndDelete.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: postId, author: authorId }),
    });
    mockCommentModel.deleteMany.mockResolvedValue({ deletedCount: 2 });
    mockLikeModel.deleteMany.mockResolvedValue({ deletedCount: 3 });
    mockReportModel.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const result = await service.deleteContent(
      'blog_post',
      String(postId),
      adminUser,
      '127.0.0.1',
    );

    expect(mockCommentModel.deleteMany).toHaveBeenCalledWith({ post: postId });
    expect(mockLikeModel.deleteMany).toHaveBeenCalledWith({ post: postId });
    expect(mockReportModel.updateMany).toHaveBeenCalledWith(
      {
        targetType: ReportTargetType.BLOG_POST,
        targetId: postId,
        status: ReportStatus.PENDING,
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: ReportStatus.CONTENT_DELETED,
        }) as unknown,
      }),
    );
    expect(mockNotificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: authorId,
        type: NotificationType.MODERATION_ACTION,
        relatedEntityType: 'BlogPost',
      }),
    );
    expect(mockAuditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CONTENT_DELETED',
        targetType: 'BlogPost',
        targetId: String(postId),
      }),
    );
    expect(result).toEqual({
      message: 'BlogPost deleted successfully',
      type: 'blog_post',
      id: String(postId),
      ownerId: String(authorId),
      resolvedPendingReports: 1,
    });
  });

  it('deletes itinerary and its child activities, budgets, and transport costs', async () => {
    const itineraryId = new Types.ObjectId('507f1f77bcf86cd799439033');
    const ownerId = new Types.ObjectId('507f1f77bcf86cd799439044');

    mockItineraryModel.findByIdAndDelete.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: itineraryId, user: ownerId }),
    });
    mockActivityModel.deleteMany.mockResolvedValue({});
    mockBudgetEntryModel.deleteMany.mockResolvedValue({});
    mockTransportCostModel.deleteMany.mockResolvedValue({});
    mockReportModel.updateMany.mockResolvedValue({ modifiedCount: 0 });

    const result = await service.deleteContent(
      'itinerary',
      String(itineraryId),
      adminUser,
    );

    expect(mockActivityModel.deleteMany).toHaveBeenCalledWith({
      itinerary: itineraryId,
    });
    expect(mockBudgetEntryModel.deleteMany).toHaveBeenCalledWith({
      itinerary: itineraryId,
    });
    expect(mockTransportCostModel.deleteMany).toHaveBeenCalledWith({
      itinerary: itineraryId,
    });
    expect(result.type).toBe('itinerary');
  });

  it('rejects invalid content type/id and missing target content', async () => {
    await expect(
      service.deleteContent('unknown', '507f1f77bcf86cd799439022', adminUser),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.deleteContent('comment', 'bad-id', adminUser),
    ).rejects.toThrow(BadRequestException);

    mockCommentModel.findByIdAndDelete.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.deleteContent('comment', '507f1f77bcf86cd799439022', adminUser),
    ).rejects.toThrow(NotFoundException);
  });
});
