import {
  BadRequestException,
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
import { DeleteContentResponseDto } from './dto/delete-content-response.dto';

const CONTENT_TYPE_MAP: Record<
  string,
  { targetType: ReportTargetType; entityLabel: string; slug: string }
> = {
  blog_post: {
    targetType: ReportTargetType.BLOG_POST,
    entityLabel: 'BlogPost',
    slug: 'blog_post',
  },
  comment: {
    targetType: ReportTargetType.COMMENT,
    entityLabel: 'Comment',
    slug: 'comment',
  },
  itinerary: {
    targetType: ReportTargetType.ITINERARY,
    entityLabel: 'Itinerary',
    slug: 'itinerary',
  },
  review: {
    targetType: ReportTargetType.REVIEW,
    entityLabel: 'Review',
    slug: 'review',
  },
};

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
   * Deletes inappropriate content directly by type (blog_post, comment, itinerary,
   * review) and ID, cleans up related child documents, resolves pending reports on
   * that target, notifies the content owner, and records an AuditLog.
   */
  async deleteContent(
    rawType: string,
    contentId: string,
    admin: AuthenticatedUser,
    ipAddress?: string,
  ): Promise<DeleteContentResponseDto> {
    const normalizedKey = rawType.trim().toLowerCase();
    const mapping = CONTENT_TYPE_MAP[normalizedKey];
    if (!mapping) {
      throw new BadRequestException(
        'Content type must be one of: blog_post, comment, itinerary, review',
      );
    }

    if (!isValidObjectId(contentId)) {
      throw new BadRequestException('Invalid content ID');
    }

    const targetObjectId = new Types.ObjectId(contentId);
    const ownerId = await this.removeTargetAndGetOwner(
      mapping.targetType,
      targetObjectId,
    );

    const now = new Date();
    const reportUpdate = await this.reportModel.updateMany(
      {
        targetType: mapping.targetType,
        targetId: targetObjectId,
        status: ReportStatus.PENDING,
      },
      {
        $set: {
          status: ReportStatus.CONTENT_DELETED,
          reviewedBy: new Types.ObjectId(admin.userId),
          reviewedAt: now,
          resolutionNotes: 'Content deleted directly by administrator',
        },
      },
    );

    await this.notificationsService.createNotification({
      recipient: ownerId,
      type: NotificationType.MODERATION_ACTION,
      title: 'Content Removed by Administrator',
      message: `Your ${mapping.entityLabel} was removed by an administrator for violating platform guidelines.`,
      relatedEntityType: mapping.entityLabel,
      relatedEntityId: targetObjectId,
    });

    await this.auditLogsService.log({
      actor: admin.userId,
      actorRole: admin.role,
      action: 'CONTENT_DELETED',
      targetType: mapping.entityLabel,
      targetId: contentId,
      details: {
        contentType: mapping.slug,
        ownerId: String(ownerId),
        resolvedPendingReports: reportUpdate.modifiedCount ?? 0,
      },
      ipAddress,
    });

    return {
      message: `${mapping.entityLabel} deleted successfully`,
      type: mapping.slug,
      id: contentId,
      ownerId: String(ownerId),
      resolvedPendingReports: reportUpdate.modifiedCount ?? 0,
    };
  }

  private async removeTargetAndGetOwner(
    targetType: ReportTargetType,
    targetId: Types.ObjectId,
  ): Promise<Types.ObjectId> {
    switch (targetType) {
      case ReportTargetType.BLOG_POST: {
        const post = await this.blogPostModel
          .findByIdAndDelete(targetId)
          .lean();
        if (!post) {
          throw new NotFoundException('Blog post not found');
        }
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
        if (!comment) {
          throw new NotFoundException('Comment not found');
        }
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
        if (!itinerary) {
          throw new NotFoundException('Itinerary not found');
        }
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
        if (!review) {
          throw new NotFoundException('Review not found');
        }
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
}
