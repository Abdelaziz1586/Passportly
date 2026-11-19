import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { NotificationType, Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DeleteCommentResponseDto } from './dto/blog-post-response.dto';
import { BlogPost, BlogPostDocument } from './schemas/blog-post.schema';
import { Comment, CommentDocument } from './schemas/comment.schema';
import { Like, LikeDocument } from './schemas/like.schema';
import { Tag, TagDocument } from './schemas/tag.schema';

@Injectable()
export class BlogService {
  constructor(
    @InjectModel(BlogPost.name)
    readonly blogPostModel: Model<BlogPostDocument>,
    @InjectModel(Comment.name) readonly commentModel: Model<CommentDocument>,
    @InjectModel(Like.name) readonly likeModel: Model<LikeDocument>,
    @InjectModel(Tag.name) readonly tagModel: Model<TagDocument>,
    private readonly auditLogsService: AuditLogsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Deletes a comment (author or ADMIN) and atomically decrements
   * BlogPost.commentsCount guarded against negative counts.
   */
  async deleteComment(
    commentId: string,
    user: AuthenticatedUser,
    ipAddress?: string,
  ): Promise<DeleteCommentResponseDto> {
    if (!isValidObjectId(commentId)) {
      throw new BadRequestException('Invalid comment ID');
    }

    const comment = await this.commentModel.findById(commentId).lean();
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    const isAuthor = String(comment.author) === user.userId;
    const isAdmin = user.role === Role.ADMIN;
    if (!isAuthor && !isAdmin) {
      throw new ForbiddenException(
        'You do not have permission to delete this comment',
      );
    }

    const deleted = await this.commentModel
      .findByIdAndDelete(comment._id)
      .lean();
    if (!deleted) {
      throw new NotFoundException('Comment not found');
    }

    await this.blogPostModel.updateOne(
      { _id: deleted.post, commentsCount: { $gt: 0 } },
      { $inc: { commentsCount: -1 } },
    );

    if (isAdmin && !isAuthor) {
      await Promise.all([
        this.notificationsService.createNotification({
          recipient: deleted.author,
          type: NotificationType.MODERATION_ACTION,
          title: 'Comment Removed by Administrator',
          message:
            'Your blog comment was removed by an administrator for violating platform guidelines.',
          relatedEntityType: 'Comment',
          relatedEntityId: deleted._id,
        }),
        this.auditLogsService.log({
          actor: user.userId,
          actorRole: user.role,
          action: 'CONTENT_DELETED',
          targetType: 'Comment',
          targetId: String(deleted._id),
          details: {
            postId: String(deleted.post),
            ownerId: String(deleted.author),
          },
          ipAddress,
        }),
      ]);
    }

    return {
      message: 'Comment deleted successfully',
      id: commentId,
      postId: String(deleted.post),
    };
  }
}
