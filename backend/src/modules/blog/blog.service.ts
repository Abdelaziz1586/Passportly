import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { PostStatus } from '../../common/enums';
import { PostLikeResponseDto } from './dto/blog-post-response.dto';
import { BlogPost, BlogPostDocument } from './schemas/blog-post.schema';
import { Comment, CommentDocument } from './schemas/comment.schema';
import { Like, LikeDocument } from './schemas/like.schema';
import { Tag, TagDocument } from './schemas/tag.schema';

function isMongoDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
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
   * Likes a published, non-hidden blog post at most once per user using the
   * unique (post, user) index and atomically increments BlogPost.likesCount.
   */
  async likePost(postId: string, userId: string): Promise<PostLikeResponseDto> {
    if (!isValidObjectId(postId)) {
      throw new BadRequestException('Invalid blog post ID');
    }
    if (!isValidObjectId(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const post = await this.blogPostModel
      .findOne({ _id: postId, status: PostStatus.PUBLISHED, isHidden: false })
      .select('_id likesCount')
      .lean();

    if (!post) {
      throw new NotFoundException('Published blog post not found');
    }

    try {
      await this.likeModel.create({
        post: post._id,
        user: new Types.ObjectId(userId),
      });
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        throw new ConflictException('You have already liked this post');
      }
      throw error;
    }

    const updated = await this.blogPostModel
      .findByIdAndUpdate(
        post._id,
        { $inc: { likesCount: 1 } },
        { returnDocument: 'after' },
      )
      .select('likesCount')
      .lean();

    return {
      message: 'Post liked successfully',
      postId,
      liked: true,
      likesCount: updated?.likesCount ?? post.likesCount + 1,
    };
  }
}
