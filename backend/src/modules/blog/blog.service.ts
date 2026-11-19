import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { PostStatus, Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import {
  extractAuthorId,
  formatBlogPost,
  formatComment,
  LeanBlogPostLike,
  LeanCommentLike,
} from './blog.utils';
import { BlogPostDetailResponseDto } from './dto/blog-post-response.dto';
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
}
