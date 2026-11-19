import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { PostStatus } from '../../common/enums';
import {
  buildExcerpt,
  formatBlogPost,
  generatePostSlug,
  LeanBlogPostLike,
  normalizeTags,
} from './blog.utils';
import { BlogPostItemDto } from './dto/blog-post-response.dto';
import { CreatePostDto } from './dto/create-post.dto';
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
}
