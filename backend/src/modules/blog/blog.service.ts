import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { formatComment, LeanCommentLike } from './blog.utils';
import { BlogCommentItemDto } from './dto/blog-post-response.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
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
}
