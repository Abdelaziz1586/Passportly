import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { PostStatus } from '../../common/enums';
import { formatComment, LeanCommentLike } from './blog.utils';
import { BlogCommentItemDto } from './dto/blog-post-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
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
      throw new BadRequestException('Invalid author user ID');
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
}
