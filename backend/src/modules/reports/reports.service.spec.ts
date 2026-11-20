import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import {
  ItineraryVisibility,
  PostStatus,
  ReportStatus,
  ReportTargetType,
  Role,
} from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BlogPost } from '../blog/schemas/blog-post.schema';
import { Comment } from '../blog/schemas/comment.schema';
import { Review } from '../hotels/schemas/review.schema';
import { Itinerary } from '../itineraries/schemas/itinerary.schema';
import { ReportsService } from './reports.service';
import { Report } from './schemas/report.schema';

describe('ReportsService (GEN-09 create report)', () => {
  let service: ReportsService;

  const mockReportModel = {
    exists: jest.fn(),
    create: jest.fn(),
  };
  const mockBlogPostModel = { findById: jest.fn() };
  const mockCommentModel = { findById: jest.fn() };
  const mockItineraryModel = { findById: jest.fn() };
  const mockReviewModel = { findById: jest.fn() };

  const traveler: AuthenticatedUser = {
    userId: '507f1f77bcf86cd799439011',
    email: 'traveler@example.com',
    role: Role.REGISTERED_USER,
    jti: 'jti-1',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getModelToken(Report.name), useValue: mockReportModel },
        { provide: getModelToken(BlogPost.name), useValue: mockBlogPostModel },
        { provide: getModelToken(Comment.name), useValue: mockCommentModel },
        {
          provide: getModelToken(Itinerary.name),
          useValue: mockItineraryModel,
        },
        { provide: getModelToken(Review.name), useValue: mockReviewModel },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  it('creates a PENDING report when reporting a published blog post', async () => {
    const targetId = '507f1f77bcf86cd799439022';
    mockBlogPostModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(targetId),
          author: new Types.ObjectId('507f1f77bcf86cd799439099'),
          status: PostStatus.PUBLISHED,
          isHidden: false,
        }),
      }),
    });
    mockReportModel.exists.mockResolvedValue(null);
    mockReportModel.create.mockResolvedValue({
      _id: new Types.ObjectId('507f1f77bcf86cd799439033'),
      reporter: new Types.ObjectId(traveler.userId),
      targetType: ReportTargetType.BLOG_POST,
      targetId: new Types.ObjectId(targetId),
      reason: 'Spam',
      details: 'Promo link',
      status: ReportStatus.PENDING,
    });

    const result = await service.createReport(traveler, {
      targetType: ReportTargetType.BLOG_POST,
      targetId,
      reason: 'Spam',
      details: 'Promo link',
    });

    expect(result.status).toBe(ReportStatus.PENDING);
    expect(result.targetType).toBe(ReportTargetType.BLOG_POST);
    expect(result.targetId).toBe(targetId);
  });

  it('rejects reporting another user private itinerary with NotFoundException', async () => {
    const targetId = '507f1f77bcf86cd799439022';
    mockItineraryModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(targetId),
          user: new Types.ObjectId('507f1f77bcf86cd799439099'),
          visibility: ItineraryVisibility.PRIVATE,
          isHidden: false,
        }),
      }),
    });

    await expect(
      service.createReport(traveler, {
        targetType: ReportTargetType.ITINERARY,
        targetId,
        reason: 'Abusive',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('validates comment and review target types', async () => {
    const commentId = '507f1f77bcf86cd799439044';
    mockCommentModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(commentId),
          isHidden: false,
        }),
      }),
    });
    mockReportModel.exists.mockResolvedValue(null);
    mockReportModel.create.mockResolvedValue({
      _id: new Types.ObjectId('507f1f77bcf86cd799439055'),
      reporter: new Types.ObjectId(traveler.userId),
      targetType: ReportTargetType.COMMENT,
      targetId: new Types.ObjectId(commentId),
      reason: 'Harassment',
      status: ReportStatus.PENDING,
    });

    const commentReport = await service.createReport(traveler, {
      targetType: ReportTargetType.COMMENT,
      targetId: commentId,
      reason: 'Harassment',
    });
    expect(commentReport.targetType).toBe(ReportTargetType.COMMENT);

    mockReviewModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    await expect(
      service.createReport(traveler, {
        targetType: ReportTargetType.REVIEW,
        targetId: commentId,
        reason: 'Fake review',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('prevents duplicate PENDING reports by the same reporter', async () => {
    const targetId = '507f1f77bcf86cd799439022';
    mockReviewModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(targetId),
          isHidden: false,
        }),
      }),
    });
    mockReportModel.exists.mockResolvedValue({ _id: 'existing' });

    await expect(
      service.createReport(traveler, {
        targetType: ReportTargetType.REVIEW,
        targetId,
        reason: 'Offensive',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('throws BadRequestException for invalid targetId', async () => {
    await expect(
      service.createReport(traveler, {
        targetType: ReportTargetType.BLOG_POST,
        targetId: 'bad-id',
        reason: 'Spam',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
