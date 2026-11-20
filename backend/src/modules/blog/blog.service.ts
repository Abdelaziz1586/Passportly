import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { PostStatus, Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
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
  BlogPostDetailResponseDto,
  BlogPostItemDto,
  PaginatedBlogPostsResponseDto,
} from './dto/blog-post-response.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { ListMyPostsQueryDto } from './dto/list-my-posts-query.dto';
import { ListPostsQueryDto } from './dto/list-posts-query.dto';
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
  ) {}

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
}
