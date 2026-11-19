import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import {
  NotificationType,
  ReportStatus,
  ReportTargetType,
} from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { BlogPost, BlogPostDocument } from '../blog/schemas/blog-post.schema';
import { Comment, CommentDocument } from '../blog/schemas/comment.schema';
import { Like, LikeDocument } from '../blog/schemas/like.schema';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import { Review, ReviewDocument } from '../hotels/schemas/review.schema';
import {
  Activity,
  ActivityDocument,
} from '../itineraries/schemas/activity.schema';
import {
  BudgetEntry,
  BudgetEntryDocument,
} from '../itineraries/schemas/budget-entry.schema';
import {
  Itinerary,
  ItineraryDocument,
} from '../itineraries/schemas/itinerary.schema';
import {
  TransportCost,
  TransportCostDocument,
} from '../itineraries/schemas/transport-cost.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { Report, ReportDocument } from '../reports/schemas/report.schema';
import {
  ModeratorAssignment,
  ModeratorAssignmentDocument,
} from '../users/schemas/moderator-assignment.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  ResolveReportDto,
  ResolveReportResponseDto,
} from './dto/resolve-report.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) readonly userModel: Model<UserDocument>,
    @InjectModel(ModeratorAssignment.name)
    readonly moderatorAssignmentModel: Model<ModeratorAssignmentDocument>,
    @InjectModel(Report.name) readonly reportModel: Model<ReportDocument>,
    @InjectModel(BlogPost.name)
    readonly blogPostModel: Model<BlogPostDocument>,
    @InjectModel(Comment.name) readonly commentModel: Model<CommentDocument>,
    @InjectModel(Like.name) readonly likeModel: Model<LikeDocument>,
    @InjectModel(Itinerary.name)
    readonly itineraryModel: Model<ItineraryDocument>,
    @InjectModel(Activity.name) readonly activityModel: Model<ActivityDocument>,
    @InjectModel(BudgetEntry.name)
    readonly budgetEntryModel: Model<BudgetEntryDocument>,
    @InjectModel(TransportCost.name)
    readonly transportCostModel: Model<TransportCostDocument>,
    @InjectModel(Review.name) readonly reviewModel: Model<ReviewDocument>,
    @InjectModel(Hotel.name) readonly hotelModel: Model<HotelDocument>,
    readonly auditLogsService: AuditLogsService,
    readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Resolves a pending content report (DISMISSED, CONTENT_HIDDEN, or CONTENT_DELETED),
   * performs the corresponding content moderation action, notifies author & reporter,
   * and writes an AuditLog entry.
   */
  async resolveReport(
    reportId: string,
    dto: ResolveReportDto,
    admin: AuthenticatedUser,
    ipAddress?: string,
  ): Promise<ResolveReportResponseDto> {
    if (!isValidObjectId(reportId)) {
      throw new BadRequestException('Invalid report ID');
    }

    const report = await this.reportModel.findById(reportId).lean();
    if (!report) {
      throw new NotFoundException('Report not found');
    }

    if (report.status !== ReportStatus.PENDING) {
      throw new ConflictException('Report has already been resolved');
    }

    let contentOwnerId: Types.ObjectId | undefined;
    if (dto.status === ReportStatus.CONTENT_HIDDEN) {
      contentOwnerId = await this.hideTargetContent(
        report.targetType,
        report.targetId,
      );
    } else if (dto.status === ReportStatus.CONTENT_DELETED) {
      contentOwnerId = await this.deleteTargetContent(
        report.targetType,
        report.targetId,
      );
    }

    const reviewedAt = new Date();
    const resolutionNotes = dto.resolutionNotes?.trim() || undefined;

    const updated = await this.reportModel
      .findByIdAndUpdate(
        report._id,
        {
          $set: {
            status: dto.status,
            reviewedBy: new Types.ObjectId(admin.userId),
            reviewedAt,
            ...(resolutionNotes !== undefined ? { resolutionNotes } : {}),
          },
        },
        { returnDocument: 'after' },
      )
      .lean();

    await this.notifyModerationParties(
      report.targetType,
      report.targetId,
      report.reporter,
      contentOwnerId,
      dto.status,
    );

    await this.auditLogsService.log({
      actor: admin.userId,
      actorRole: admin.role,
      action: 'REPORT_RESOLVED',
      targetType: 'Report',
      targetId: String(report._id),
      details: {
        resolution: dto.status,
        reportTargetType: report.targetType,
        reportTargetId: String(report.targetId),
        ...(resolutionNotes !== undefined ? { resolutionNotes } : {}),
      },
      ipAddress,
    });

    const finalDoc = updated ?? report;
    return {
      id: String(finalDoc._id),
      reporter: String(finalDoc.reporter),
      targetType: finalDoc.targetType,
      targetId: String(finalDoc.targetId),
      reason: finalDoc.reason,
      status: dto.status,
      reviewedBy: admin.userId,
      reviewedAt,
      ...(resolutionNotes !== undefined ? { resolutionNotes } : {}),
    };
  }

  private async hideTargetContent(
    targetType: ReportTargetType,
    targetId: Types.ObjectId,
  ): Promise<Types.ObjectId> {
    switch (targetType) {
      case ReportTargetType.BLOG_POST: {
        const post = await this.blogPostModel
          .findByIdAndUpdate(
            targetId,
            { $set: { isHidden: true } },
            { returnDocument: 'after' },
          )
          .select('author')
          .lean();
        if (!post) {
          throw new NotFoundException('Reported blog post not found');
        }
        return post.author;
      }
      case ReportTargetType.COMMENT: {
        const comment = await this.commentModel
          .findByIdAndUpdate(
            targetId,
            { $set: { isHidden: true } },
            { returnDocument: 'after' },
          )
          .select('author')
          .lean();
        if (!comment) {
          throw new NotFoundException('Reported comment not found');
        }
        return comment.author;
      }
      case ReportTargetType.ITINERARY: {
        const itinerary = await this.itineraryModel
          .findByIdAndUpdate(
            targetId,
            { $set: { isHidden: true } },
            { returnDocument: 'after' },
          )
          .select('user')
          .lean();
        if (!itinerary) {
          throw new NotFoundException('Reported itinerary not found');
        }
        return itinerary.user;
      }
      case ReportTargetType.REVIEW: {
        const review = await this.reviewModel
          .findByIdAndUpdate(
            targetId,
            { $set: { isHidden: true } },
            { returnDocument: 'after' },
          )
          .select('user hotel')
          .lean();
        if (!review) {
          throw new NotFoundException('Reported review not found');
        }
        await this.recalculateHotelRating(review.hotel);
        return review.user;
      }
    }
  }

  private async deleteTargetContent(
    targetType: ReportTargetType,
    targetId: Types.ObjectId,
  ): Promise<Types.ObjectId | undefined> {
    switch (targetType) {
      case ReportTargetType.BLOG_POST: {
        const post = await this.blogPostModel
          .findByIdAndDelete(targetId)
          .lean();
        if (!post) return undefined;
        await Promise.all([
          this.commentModel.deleteMany({ post: post._id }),
          this.likeModel.deleteMany({ post: post._id }),
        ]);
        return post.author;
      }
      case ReportTargetType.COMMENT: {
        const comment = await this.commentModel
          .findByIdAndDelete(targetId)
          .lean();
        if (!comment) return undefined;
        await this.blogPostModel.updateOne(
          { _id: comment.post, commentsCount: { $gt: 0 } },
          { $inc: { commentsCount: -1 } },
        );
        return comment.author;
      }
      case ReportTargetType.ITINERARY: {
        const itinerary = await this.itineraryModel
          .findByIdAndDelete(targetId)
          .lean();
        if (!itinerary) return undefined;
        await Promise.all([
          this.activityModel.deleteMany({ itinerary: itinerary._id }),
          this.budgetEntryModel.deleteMany({ itinerary: itinerary._id }),
          this.transportCostModel.deleteMany({ itinerary: itinerary._id }),
        ]);
        return itinerary.user;
      }
      case ReportTargetType.REVIEW: {
        const review = await this.reviewModel
          .findByIdAndDelete(targetId)
          .lean();
        if (!review) return undefined;
        await this.recalculateHotelRating(review.hotel);
        return review.user;
      }
    }
  }

  private async recalculateHotelRating(hotelId: Types.ObjectId): Promise<void> {
    const visibleReviews = await this.reviewModel
      .find({ hotel: hotelId, isHidden: false })
      .select('rating')
      .lean();
    const reviewCount = visibleReviews.length;
    const averageRating =
      reviewCount === 0
        ? 0
        : Number(
            (
              visibleReviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
            ).toFixed(2),
          );
    await this.hotelModel.updateOne(
      { _id: hotelId },
      { $set: { averageRating, reviewCount } },
    );
  }

  private async notifyModerationParties(
    targetType: ReportTargetType,
    targetId: Types.ObjectId,
    reporterId: Types.ObjectId,
    ownerId: Types.ObjectId | undefined,
    resolution:
      | ReportStatus.DISMISSED
      | ReportStatus.CONTENT_HIDDEN
      | ReportStatus.CONTENT_DELETED,
  ): Promise<void> {
    const entityType = this.toEntityTypeLabel(targetType);
    const tasks: Promise<unknown>[] = [];

    if (
      resolution === ReportStatus.CONTENT_HIDDEN ||
      resolution === ReportStatus.CONTENT_DELETED
    ) {
      const actionLabel =
        resolution === ReportStatus.CONTENT_HIDDEN ? 'hidden' : 'deleted';

      if (ownerId) {
        tasks.push(
          this.notificationsService.createNotification({
            recipient: ownerId,
            type: NotificationType.MODERATION_ACTION,
            title: 'Content Moderation Notice',
            message: `Your ${entityType} was ${actionLabel} by an administrator following a content report.`,
            relatedEntityType: entityType,
            relatedEntityId: targetId,
          }),
        );
      }

      if (!ownerId || String(ownerId) !== String(reporterId)) {
        tasks.push(
          this.notificationsService.createNotification({
            recipient: reporterId,
            type: NotificationType.MODERATION_ACTION,
            title: 'Report Resolved',
            message: `Your report regarding a ${entityType} was reviewed and the content has been ${actionLabel}.`,
            relatedEntityType: 'Report',
            relatedEntityId: targetId,
          }),
        );
      }
    } else {
      tasks.push(
        this.notificationsService.createNotification({
          recipient: reporterId,
          type: NotificationType.MODERATION_ACTION,
          title: 'Report Reviewed',
          message: `Your report regarding a ${entityType} was reviewed and dismissed.`,
          relatedEntityType: 'Report',
          relatedEntityId: targetId,
        }),
      );
    }

    await Promise.all(tasks);
  }

  private toEntityTypeLabel(targetType: ReportTargetType): string {
    switch (targetType) {
      case ReportTargetType.BLOG_POST:
        return 'BlogPost';
      case ReportTargetType.COMMENT:
        return 'Comment';
      case ReportTargetType.ITINERARY:
        return 'Itinerary';
      case ReportTargetType.REVIEW:
        return 'Review';
    }
  }
}
