import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { NotificationType, PostStatus, Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  buildExcerpt,
  escapeRegex,
  extractAuthorId,
  formatBlogPost,
  formatComment,
  generatePostSlug,
  LeanBlogPostLike,
  LeanCommentLike,
  normalizeTags,
  slugify,
} from './blog.utils';
import {
  BlogCommentItemDto,
  BlogPostDetailResponseDto,
  BlogPostItemDto,
  DeleteBlogPostResponseDto,
  DeleteCommentResponseDto,
  PaginatedBlogPostsResponseDto,
  PostLikeResponseDto,
} from './dto/blog-post-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { ListMyPostsQueryDto } from './dto/list-my-posts-query.dto';
import { ListPostsQueryDto } from './dto/list-posts-query.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { BlogPost, BlogPostDocument } from './schemas/blog-post.schema';
import { Comment, CommentDocument } from './schemas/comment.schema';
import { Like, LikeDocument } from './schemas/like.schema';
import { Tag, TagDocument } from './schemas/tag.schema';


function isMongoDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

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
   * Updates a blog comment authored by the authenticated user.
   */
  async updateComment(
    commentId: string,
    userId: string,
    dto: UpdateCommentDto,
  ): Promise<BlogCommentItemDto> {
    if (!isValidObjectId(commentId)) {
      throw new BadRequestException('Invalid comment ID');
    }

    const comment = await this.commentModel.findById(commentId).lean();
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if (String(comment.author) !== userId) {
      throw new ForbiddenException('You can only update your own comments');
    }

    if (comment.isHidden) {
      throw new ForbiddenException('Hidden comments cannot be edited');
    }

    const updated = await this.commentModel
      .findByIdAndUpdate(
        comment._id,
        { $set: { content: dto.content } },
        { returnDocument: 'after' },
      )
      .lean<LeanCommentLike | null>();

    if (!updated) {
      throw new NotFoundException('Comment not found');
    }

    return formatComment(updated);
  }

  /**
   * Verifies that a blog post is published and not hidden, atomically increments
   * BlogPost.commentsCount, and creates the new Comment document.
   */
  async addComment(
    postId: string,
    userId: string,
    dto: CreateCommentDto,
  ): Promise<BlogCommentItemDto> {
    if (!isValidObjectId(postId)) {
      throw new BadRequestException('Invalid blog post ID');
    }
    if (!isValidObjectId(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const updatedPost = await this.blogPostModel
      .findOneAndUpdate(
        { _id: postId, status: PostStatus.PUBLISHED, isHidden: false },
        { $inc: { commentsCount: 1 } },
        { returnDocument: 'after' },
      )
      .lean();

    if (!updatedPost) {
      throw new NotFoundException('Published blog post not found');
    }

    try {
      const created = await this.commentModel.create({
        post: updatedPost._id,
        author: new Types.ObjectId(userId),
        content: dto.content,
        isHidden: false,
      });

      const plainComment =
        typeof created.toObject === 'function'
          ? (created.toObject() as unknown as LeanCommentLike)
          : (created as unknown as LeanCommentLike);

      return formatComment(plainComment);
    } catch (error) {
      await this.blogPostModel
        .updateOne(
          { _id: updatedPost._id, commentsCount: { $gt: 0 } },
          { $inc: { commentsCount: -1 } },
        )
        .catch(() => undefined);
      throw error;
    }
  }

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

  /**
   * Updates a blog post owned by the authenticated author, synchronizes Tag
   * documents and usageCounts when tags change, and sets publishedAt on first publish.
   */
  async updatePost(
    postId: string,
    userId: string,
    dto: UpdatePostDto,
  ): Promise<BlogPostItemDto> {
    if (!isValidObjectId(postId)) {
      throw new BadRequestException('Invalid blog post ID');
    }

    const hasUpdates =
      dto.title !== undefined ||
      dto.content !== undefined ||
      dto.excerpt !== undefined ||
      dto.status !== undefined ||
      dto.tags !== undefined;
    if (!hasUpdates) {
      throw new BadRequestException('At least one field must be provided');
    }

    const post = await this.blogPostModel.findById(postId).lean();
    if (!post) {
      throw new NotFoundException('Blog post not found');
    }

    if (String(post.author) !== userId) {
      throw new ForbiddenException('You can only update your own blog posts');
    }

    const updateSet: Record<string, unknown> = {};

    if (dto.title !== undefined) {
      updateSet.title = dto.title;
      if (dto.title !== post.title) {
        updateSet.slug = generatePostSlug(dto.title);
      }
    }

    if (dto.content !== undefined) {
      updateSet.content = dto.content;
      if (dto.excerpt === undefined && !post.excerpt) {
        updateSet.excerpt = buildExcerpt(dto.content);
      }
    }

    if (dto.excerpt !== undefined) {
      updateSet.excerpt = dto.excerpt;
    }

    if (dto.status !== undefined) {
      updateSet.status = dto.status;
      if (dto.status === PostStatus.PUBLISHED && !post.publishedAt) {
        updateSet.publishedAt = new Date();
      }
    }

    if (dto.tags !== undefined) {
      const normalized = normalizeTags(dto.tags);
      const newTagDocs = await Promise.all(
        normalized.map((tag) =>
          this.tagModel
            .findOneAndUpdate(
              { slug: tag.slug },
              {
                $setOnInsert: {
                  name: tag.name,
                  slug: tag.slug,
                  usageCount: 0,
                },
              },
              { upsert: true, returnDocument: 'after' },
            )
            .lean(),
        ),
      );

      let existingTagIds = (post.tagRefs ?? []).map((id) => String(id));
      if (existingTagIds.length === 0 && (post.tags?.length ?? 0) > 0) {
        const legacyTags = await this.tagModel
          .find({ slug: { $in: post.tags } })
          .select('_id')
          .lean();
        existingTagIds = legacyTags.map((t) => String(t._id));
      }

      const oldSet = new Set(existingTagIds);
      const newSet = new Set(newTagDocs.map((t) => String(t._id)));

      const addedIds = newTagDocs
        .filter((t) => !oldSet.has(String(t._id)))
        .map((t) => t._id);
      const removedIds = existingTagIds
        .filter((id) => !newSet.has(id))
        .map((id) => new Types.ObjectId(id));

      if (addedIds.length > 0) {
        await this.tagModel.updateMany(
          { _id: { $in: addedIds } },
          { $inc: { usageCount: 1 } },
        );
      }

      if (removedIds.length > 0) {
        await this.tagModel.updateMany(
          { _id: { $in: removedIds }, usageCount: { $gt: 0 } },
          { $inc: { usageCount: -1 } },
        );
      }

      updateSet.tags = newTagDocs.map((t) => t.slug);
      updateSet.tagRefs = newTagDocs.map((t) => t._id);
    }

    const updated = await this.blogPostModel
      .findByIdAndUpdate(
        post._id,
        { $set: updateSet },
        { returnDocument: 'after' },
      )
      .lean<LeanBlogPostLike | null>();

    if (!updated) {
      throw new NotFoundException('Blog post not found');
    }

    return formatBlogPost(updated);
  }

  /**
   * Returns a published, non-hidden blog post (or a draft to its own author)
   * with safe author profile summary and visible comments.
   */
  async getPost(
    postId: string,
    currentUser?: AuthenticatedUser,
  ): Promise<BlogPostDetailResponseDto> {
    if (!isValidObjectId(postId)) {
      throw new BadRequestException('Invalid blog post ID');
    }

    const post = await this.blogPostModel
      .findById(postId)
      .populate('author', 'firstName lastName avatarUrl bio')
      .lean<LeanBlogPostLike | null>();

    if (!post) {
      throw new NotFoundException('Blog post not found');
    }

    const authorId = extractAuthorId(post.author);
    const isAuthor = Boolean(currentUser && currentUser.userId === authorId);
    const isAdmin = currentUser?.role === Role.ADMIN;

    if (post.isHidden && !isAdmin) {
      throw new NotFoundException('Blog post not found');
    }

    if (post.status !== PostStatus.PUBLISHED && !isAuthor) {
      throw new NotFoundException('Blog post not found');
    }

    const comments = await this.commentModel
      .find({ post: post._id, isHidden: false })
      .populate('author', 'firstName lastName avatarUrl')
      .sort({ createdAt: 1, _id: 1 })
      .lean<LeanCommentLike[]>();

    return {
      ...formatBlogPost(post),
      comments: comments.map((comment) => formatComment(comment)),
    };
  }

  /**
   * Lists paginated blog posts authored by the authenticated user (both drafts
   * and published posts) with optional status filtering and sorting.
   */
  async listMyPosts(
    userId: string,
    query: ListMyPostsQueryDto,
  ): Promise<PaginatedBlogPostsResponseDto> {
    if (!isValidObjectId(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'updatedAt';
    const sortDirection = query.sortOrder === 'asc' ? 1 : -1;

    const filter: Record<string, unknown> = {
      author: new Types.ObjectId(userId),
    };
    if (query.status) {
      filter.status = query.status;
    }

    const [posts, total] = await Promise.all([
      this.blogPostModel
        .find(filter)
        .sort({ [sortBy]: sortDirection, _id: sortDirection })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanBlogPostLike[]>(),
      this.blogPostModel.countDocuments(filter),
    ]);

    return {
      data: posts.map((post) => formatBlogPost(post)),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  /**
   * Creates a new blog post (DRAFT or PUBLISHED), upserts normalized tags
   * incrementing their usage counts, generates a unique slug, and sets
   * publishedAt when published immediately.
   */
  async createPost(
    userId: string,
    dto: CreatePostDto,
  ): Promise<BlogPostItemDto> {
    if (!isValidObjectId(userId)) {
      throw new BadRequestException('Invalid author user ID');
    }

    const normalizedTags = normalizeTags(dto.tags);
    const upsertedTags = await Promise.all(
      normalizedTags.map((tag) =>
        this.tagModel
          .findOneAndUpdate(
            { slug: tag.slug },
            {
              $setOnInsert: { name: tag.name, slug: tag.slug },
              $inc: { usageCount: 1 },
            },
            { upsert: true, returnDocument: 'after' },
          )
          .lean(),
      ),
    );

    const status = dto.status ?? PostStatus.DRAFT;
    const publishedAt =
      status === PostStatus.PUBLISHED ? new Date() : undefined;

    const created = await this.blogPostModel.create({
      author: new Types.ObjectId(userId),
      title: dto.title,
      slug: generatePostSlug(dto.title),
      content: dto.content,
      excerpt: buildExcerpt(dto.content, dto.excerpt),
      status,
      isHidden: false,
      tags: upsertedTags.map((t) => t.slug),
      tagRefs: upsertedTags.map((t) => t._id),
      images: [],
      likesCount: 0,
      commentsCount: 0,
      attachedItinerary: null,
      ...(publishedAt !== undefined ? { publishedAt } : {}),
    });

    const plainPost =
      typeof created.toObject === 'function'
        ? (created.toObject() as unknown as LeanBlogPostLike)
        : (created as unknown as LeanBlogPostLike);

    return formatBlogPost(plainPost);
  }

  /**
   * Lists and searches published, non-hidden blog posts with optional
   * keyword search, tag filter, author filter, sorting, and pagination.
   */
  async listPosts(
    query: ListPostsQueryDto,
  ): Promise<PaginatedBlogPostsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'publishedAt';
    const sortDirection = query.sortOrder === 'asc' ? 1 : -1;

    const andConditions: Record<string, unknown>[] = [
      { status: PostStatus.PUBLISHED, isHidden: false },
    ];

    if (query.author) {
      andConditions.push({ author: new Types.ObjectId(query.author) });
    }

    if (query.tag && query.tag.trim().length > 0) {
      const normalizedName = query.tag
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
      const tagSlug = slugify(normalizedName);
      const tagCandidates = Array.from(
        new Set([normalizedName, tagSlug].filter(Boolean)),
      );

      const matchingTag = await this.tagModel
        .findOne({
          $or: [{ slug: tagSlug || normalizedName }, { name: normalizedName }],
        })
        .select('_id')
        .lean();

      const tagOrConditions: Record<string, unknown>[] = [
        { tags: { $in: tagCandidates } },
      ];
      if (matchingTag) {
        tagOrConditions.push({ tagRefs: matchingTag._id });
      }
      andConditions.push({ $or: tagOrConditions });
    }

    if (query.search && query.search.trim().length > 0) {
      const regex = new RegExp(escapeRegex(query.search.trim()), 'i');
      andConditions.push({
        $or: [
          { title: regex },
          { content: regex },
          { excerpt: regex },
          { tags: regex },
        ],
      });
    }

    const filter =
      andConditions.length === 1 ? andConditions[0] : { $and: andConditions };

    const [posts, total] = await Promise.all([
      this.blogPostModel
        .find(filter)
        .populate('author', 'firstName lastName avatarUrl')
        .sort({ [sortBy]: sortDirection, _id: sortDirection })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanBlogPostLike[]>(),
      this.blogPostModel.countDocuments(filter),
    ]);

    return {
      data: posts.map((post) => formatBlogPost(post)),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }
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
  /**
   * Likes a published, non-hidden blog post at most once per user using the
   * unique (post, user) index and atomically increments BlogPost.likesCount.
   */
  async likePost(postId: string, userId: string): Promise<PostLikeResponseDto> {
    if (!isValidObjectId(postId)) {
      throw new BadRequestException('Invalid blog post ID');
    }
    if (!isValidObjectId(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const post = await this.blogPostModel
      .findOne({ _id: postId, status: PostStatus.PUBLISHED, isHidden: false })
      .select('_id likesCount')
      .lean();

    if (!post) {
      throw new NotFoundException('Published blog post not found');
    }

    try {
      await this.likeModel.create({
        post: post._id,
        user: new Types.ObjectId(userId),
      });
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        throw new ConflictException('You have already liked this post');
      }
      throw error;
    }

    const updated = await this.blogPostModel
      .findByIdAndUpdate(
        post._id,
        { $inc: { likesCount: 1 } },
        { returnDocument: 'after' },
      )
      .select('likesCount')
      .lean();

    return {
      message: 'Post liked successfully',
      postId,
      liked: true,
      likesCount: updated?.likesCount ?? post.likesCount + 1,
    };
  }

}
