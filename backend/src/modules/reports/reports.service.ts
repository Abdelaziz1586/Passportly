import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import {
  ItineraryVisibility,
  PostStatus,
  ReportStatus,
  ReportTargetType,
  Role,
} from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BlogPost, BlogPostDocument } from '../blog/schemas/blog-post.schema';
import { Comment, CommentDocument } from '../blog/schemas/comment.schema';
import { Review, ReviewDocument } from '../hotels/schemas/review.schema';
import {
  Itinerary,
  ItineraryDocument,
} from '../itineraries/schemas/itinerary.schema';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportResponseDto } from './dto/report-response.dto';
import { Report, ReportDocument } from './schemas/report.schema';

type TimestampedReportDocument = ReportDocument & {
  createdAt?: Date;
  updatedAt?: Date;
};

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) readonly reportModel: Model<ReportDocument>,
    @InjectModel(BlogPost.name)
    readonly blogPostModel: Model<BlogPostDocument>,
    @InjectModel(Comment.name) readonly commentModel: Model<CommentDocument>,
    @InjectModel(Itinerary.name)
    readonly itineraryModel: Model<ItineraryDocument>,
    @InjectModel(Review.name) readonly reviewModel: Model<ReviewDocument>,
  ) {}

  /**
   * Validates that the reported content target exists and is accessible,
   * prevents duplicate pending reports by the same reporter, and creates a PENDING Report.
   */
  async createReport(
    user: AuthenticatedUser,
    dto: CreateReportDto,
  ): Promise<ReportResponseDto> {
    if (!isValidObjectId(dto.targetId)) {
      throw new BadRequestException('Invalid targetId');
    }
    if (!isValidObjectId(user.userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    await this.assertTargetExists(dto.targetType, dto.targetId, user);

    const reporterId = new Types.ObjectId(user.userId);
    const targetObjectId = new Types.ObjectId(dto.targetId);

    const duplicate = await this.reportModel.exists({
      reporter: reporterId,
      targetType: dto.targetType,
      targetId: targetObjectId,
      status: ReportStatus.PENDING,
    });
    if (duplicate) {
      throw new ConflictException(
        'You already have a pending report for this content',
      );
    }

    const created = await this.reportModel.create({
      reporter: reporterId,
      targetType: dto.targetType,
      targetId: targetObjectId,
      reason: dto.reason.trim(),
      ...(dto.details !== undefined ? { details: dto.details.trim() } : {}),
      status: ReportStatus.PENDING,
    });

    return this.toReportResponse(created);
  }

  private async assertTargetExists(
    targetType: ReportTargetType,
    targetId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const isAdmin = user.role === Role.ADMIN;

    switch (targetType) {
      case ReportTargetType.BLOG_POST: {
        const post = await this.blogPostModel
          .findById(targetId)
          .select('author status isHidden')
          .lean();
        if (
          !post ||
          (!isAdmin &&
            (post.isHidden ||
              (post.status !== PostStatus.PUBLISHED &&
                String(post.author) !== user.userId)))
        ) {
          throw new NotFoundException('Reported blog post not found');
        }
        return;
      }
      case ReportTargetType.COMMENT: {
        const comment = await this.commentModel
          .findById(targetId)
          .select('isHidden')
          .lean();
        if (!comment || (!isAdmin && comment.isHidden)) {
          throw new NotFoundException('Reported comment not found');
        }
        return;
      }
      case ReportTargetType.ITINERARY: {
        const itinerary = await this.itineraryModel
          .findById(targetId)
          .select('user visibility isHidden')
          .lean();
        if (
          !itinerary ||
          (!isAdmin &&
            (itinerary.isHidden ||
              (itinerary.visibility !== ItineraryVisibility.PUBLIC &&
                String(itinerary.user) !== user.userId)))
        ) {
          throw new NotFoundException('Reported itinerary not found');
        }
        return;
      }
      case ReportTargetType.REVIEW: {
        const review = await this.reviewModel
          .findById(targetId)
          .select('isHidden')
          .lean();
        if (!review || (!isAdmin && review.isHidden)) {
          throw new NotFoundException('Reported review not found');
        }
        return;
      }
    }
  }

  private toReportResponse(doc: ReportDocument): ReportResponseDto {
    const timestamped = doc as TimestampedReportDocument;
    return {
      id: String(doc._id),
      reporter: String(doc.reporter),
      targetType: doc.targetType,
      targetId: String(doc.targetId),
      reason: doc.reason,
      ...(doc.details !== undefined ? { details: doc.details } : {}),
      status: doc.status,
      ...(timestamped.createdAt !== undefined
        ? { createdAt: timestamped.createdAt }
        : {}),
      ...(timestamped.updatedAt !== undefined
        ? { updatedAt: timestamped.updatedAt }
        : {}),
    };
  }
}
