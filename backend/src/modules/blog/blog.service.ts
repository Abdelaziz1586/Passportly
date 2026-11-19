import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PostStatus } from '../../common/enums';
import {
  escapeRegex,
  formatBlogPost,
  LeanBlogPostLike,
  slugify,
} from './blog.utils';
import { PaginatedBlogPostsResponseDto } from './dto/blog-post-response.dto';
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
