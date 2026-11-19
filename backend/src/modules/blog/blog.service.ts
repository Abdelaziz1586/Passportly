import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { PostLikeResponseDto } from './dto/blog-post-response.dto';
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
   * Removes the authenticated user's Like on a blog post and decrements
   * BlogPost.likesCount only if a Like document was actually removed.
   */
  async unlikePost(
    postId: string,
    userId: string,
  ): Promise<PostLikeResponseDto> {
    if (!isValidObjectId(postId)) {
      throw new BadRequestException('Invalid blog post ID');
    }
    if (!isValidObjectId(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const post = await this.blogPostModel
      .findById(postId)
      .select('_id likesCount')
      .lean();
    if (!post) {
      throw new NotFoundException('Blog post not found');
    }

    const deletedLike = await this.likeModel
      .findOneAndDelete({
        post: post._id,
        user: new Types.ObjectId(userId),
      })
      .lean();

    if (!deletedLike) {
      return {
        message: 'No active like found for this post',
        postId,
        liked: false,
        likesCount: post.likesCount,
      };
    }

    const updated = await this.blogPostModel
      .findOneAndUpdate(
        { _id: post._id, likesCount: { $gt: 0 } },
        { $inc: { likesCount: -1 } },
        { returnDocument: 'after' },
      )
      .select('likesCount')
      .lean();

    return {
      message: 'Like removed successfully',
      postId,
      liked: false,
      likesCount: updated?.likesCount ?? Math.max(0, post.likesCount - 1),
    };
  }
}
