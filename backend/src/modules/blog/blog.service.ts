import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PostStatus } from '../../common/enums';
import { formatBlogPost, LeanBlogPostLike, slugify } from './blog.utils';
import { TagPostsResponseDto } from './dto/blog-post-response.dto';
import { ListPostsByTagQueryDto } from './dto/list-posts-by-tag-query.dto';
import { BlogPost, BlogPostDocument } from './schemas/blog-post.schema';
import { Comment, CommentDocument } from './schemas/comment.schema';
import { Like, LikeDocument } from './schemas/like.schema';
import { Tag, TagDocument } from './schemas/tag.schema';

function safeDecodeTag(rawTag: string): string {
  try {
    return decodeURIComponent(rawTag);
  } catch {
    return rawTag;
  }
}

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
   * Normalizes a tag slug or name and returns paginated published,
   * non-hidden blog posts matching that tag.
   */
  async getPostsByTag(
    rawTag: string,
    query: ListPostsByTagQueryDto,
  ): Promise<TagPostsResponseDto> {
    const normalizedName = safeDecodeTag(rawTag)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    const slug = slugify(normalizedName);
    if (!normalizedName || !slug) {
      throw new BadRequestException('Invalid tag parameter');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'publishedAt';
    const sortDirection = query.sortOrder === 'asc' ? 1 : -1;

    const tagDoc = await this.tagModel
      .findOne({ $or: [{ slug }, { name: normalizedName }] })
      .lean();

    const tagCandidates = Array.from(new Set([slug, normalizedName]));
    const tagOrConditions: Record<string, unknown>[] = [
      { tags: { $in: tagCandidates } },
    ];
    if (tagDoc) {
      tagOrConditions.push({ tagRefs: tagDoc._id });
    }

    const filter: Record<string, unknown> = {
      status: PostStatus.PUBLISHED,
      isHidden: false,
      $or: tagOrConditions,
    };

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
      tag: tagDoc
        ? {
            id: String(tagDoc._id),
            name: tagDoc.name,
            slug: tagDoc.slug,
            usageCount: tagDoc.usageCount,
          }
        : {
            name: normalizedName,
            slug,
          },
      data: posts.map((post) => formatBlogPost(post)),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }
}
