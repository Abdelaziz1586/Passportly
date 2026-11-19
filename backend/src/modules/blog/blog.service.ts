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
import { UploadsService } from '../uploads/uploads.service';
import { DeleteBlogPostResponseDto } from './dto/blog-post-response.dto';
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
    private readonly uploadsService: UploadsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Deletes a blog post (author or ADMIN), cascades deletion to its Comments
   * and Likes, decrements Tag usageCounts, and cleans up uploaded media files.
   */
  async deletePost(
    postId: string,
    user: AuthenticatedUser,
    ipAddress?: string,
  ): Promise<DeleteBlogPostResponseDto> {
    if (!isValidObjectId(postId)) {
      throw new BadRequestException('Invalid blog post ID');
    }

    const post = await this.blogPostModel.findById(postId).lean();
    if (!post) {
      throw new NotFoundException('Blog post not found');
    }

    const isAuthor = String(post.author) === user.userId;
    const isAdmin = user.role === Role.ADMIN;
    if (!isAuthor && !isAdmin) {
      throw new ForbiddenException(
        'You do not have permission to delete this blog post',
      );
    }

    const deleted = await this.blogPostModel.findByIdAndDelete(post._id).lean();
    if (!deleted) {
      throw new NotFoundException('Blog post not found');
    }

    const cleanupTasks: Promise<unknown>[] = [
      this.commentModel.deleteMany({ post: deleted._id }),
      this.likeModel.deleteMany({ post: deleted._id }),
    ];

    if ((deleted.tagRefs?.length ?? 0) > 0) {
      cleanupTasks.push(
        this.tagModel.updateMany(
          { _id: { $in: deleted.tagRefs }, usageCount: { $gt: 0 } },
          { $inc: { usageCount: -1 } },
        ),
      );
    } else if ((deleted.tags?.length ?? 0) > 0) {
      cleanupTasks.push(
        this.tagModel.updateMany(
          { slug: { $in: deleted.tags }, usageCount: { $gt: 0 } },
          { $inc: { usageCount: -1 } },
        ),
      );
    }

    for (const img of deleted.images ?? []) {
      cleanupTasks.push(this.uploadsService.deleteImage(img.url));
    }

    await Promise.all(cleanupTasks);

    if (isAdmin && !isAuthor) {
      await Promise.all([
        this.notificationsService.createNotification({
          recipient: deleted.author,
          type: NotificationType.MODERATION_ACTION,
          title: 'Blog Post Removed by Administrator',
          message: `Your blog post "${deleted.title}" was removed by an administrator.`,
          relatedEntityType: 'BlogPost',
          relatedEntityId: deleted._id,
        }),
        this.auditLogsService.log({
          actor: user.userId,
          actorRole: user.role,
          action: 'CONTENT_DELETED',
          targetType: 'BlogPost',
          targetId: String(deleted._id),
          details: { ownerId: String(deleted.author) },
          ipAddress,
        }),
      ]);
    }

    return {
      message: 'Blog post deleted successfully',
      id: postId,
    };
  }
}
