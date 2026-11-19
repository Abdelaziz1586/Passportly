import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { AccountStatus, PostStatus } from '../../common/enums';
import { User, UserDocument } from '../users/schemas/user.schema';
import { formatBlogPost, LeanBlogPostLike } from './blog.utils';
import { AuthorPostsQueryDto } from './dto/author-posts-query.dto';
import { AuthorProfileResponseDto } from './dto/blog-post-response.dto';
import { BlogPost, BlogPostDocument } from './schemas/blog-post.schema';
import { Comment, CommentDocument } from './schemas/comment.schema';
import { Like, LikeDocument } from './schemas/like.schema';
import { Tag, TagDocument } from './schemas/tag.schema';

interface LeanPublicAuthor {
  _id: Types.ObjectId | string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  bio?: string;
  status: AccountStatus;
  createdAt?: Date;
}

@Injectable()
export class BlogService {
  constructor(
    @InjectModel(BlogPost.name)
    readonly blogPostModel: Model<BlogPostDocument>,
    @InjectModel(Comment.name) readonly commentModel: Model<CommentDocument>,
    @InjectModel(Like.name) readonly likeModel: Model<LikeDocument>,
    @InjectModel(Tag.name) readonly tagModel: Model<TagDocument>,
    @InjectModel(User.name) readonly userModel: Model<UserDocument>,
  ) {}

  /**
   * Returns a safe public author profile (name, avatarUrl, bio) along with
   * a paginated list of their published, non-hidden blog posts.
   */
  async getAuthorPage(
    authorId: string,
    query: AuthorPostsQueryDto,
  ): Promise<AuthorProfileResponseDto> {
    if (!isValidObjectId(authorId)) {
      throw new BadRequestException('Invalid author ID');
    }

    const user = await this.userModel
      .findById(authorId)
      .select('firstName lastName avatarUrl bio status createdAt')
      .lean<LeanPublicAuthor | null>();

    if (!user || user.status !== AccountStatus.ACTIVE) {
      throw new NotFoundException('Author not found');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'publishedAt';
    const sortDirection = query.sortOrder === 'asc' ? 1 : -1;

    const filter = {
      author: user._id,
      status: PostStatus.PUBLISHED,
      isHidden: false,
    };

    const [posts, total] = await Promise.all([
      this.blogPostModel
        .find(filter)
        .sort({ [sortBy]: sortDirection, _id: sortDirection })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanBlogPostLike[]>(),
      this.blogPostModel.countDocuments(filter),
    ]);

    const fullName = `${user.firstName} ${user.lastName}`.trim();

    return {
      author: {
        id: String(user._id),
        firstName: user.firstName,
        lastName: user.lastName,
        fullName,
        ...(user.avatarUrl !== undefined ? { avatarUrl: user.avatarUrl } : {}),
        ...(user.bio !== undefined ? { bio: user.bio } : {}),
        ...(user.createdAt !== undefined ? { createdAt: user.createdAt } : {}),
      },
      posts: {
        data: posts.map((post) => formatBlogPost(post)),
        total,
        page,
        limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }
}
