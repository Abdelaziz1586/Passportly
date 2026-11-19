import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { formatBlogPost, LeanBlogPostLike } from './blog.utils';
import { PaginatedBlogPostsResponseDto } from './dto/blog-post-response.dto';
import { ListMyPostsQueryDto } from './dto/list-my-posts-query.dto';
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
}
