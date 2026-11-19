import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { UploadsService } from '../uploads/uploads.service';
import { formatMediaItem } from './blog.utils';
import { DeletePostImageResponseDto } from './dto/blog-post-response.dto';
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
    private readonly uploadsService: UploadsService,
  ) {}

  /**
   * Enforces post author ownership, removes the matching MediaItem subdocument
   * from BlogPost.images, and cleans up the image file via UploadsService.
   */
  async deletePostImage(
    postId: string,
    imageId: string,
    userId: string,
  ): Promise<DeletePostImageResponseDto> {
    if (!isValidObjectId(postId)) {
      throw new BadRequestException('Invalid blog post ID');
    }
    if (!isValidObjectId(imageId)) {
      throw new BadRequestException('Invalid image ID');
    }

    const post = await this.blogPostModel.findById(postId).lean();
    if (!post) {
      throw new NotFoundException('Blog post not found');
    }

    if (String(post.author) !== userId) {
      throw new ForbiddenException(
        'You can only delete images from your own blog posts',
      );
    }

    const targetImage = (post.images ?? []).find(
      (img) => String(img._id) === imageId,
    );
    if (!targetImage) {
      throw new NotFoundException('Image not found on this blog post');
    }

    const updated = await this.blogPostModel
      .findOneAndUpdate(
        { _id: post._id, author: new Types.ObjectId(userId) },
        { $pull: { images: { _id: new Types.ObjectId(imageId) } } },
        { returnDocument: 'after' },
      )
      .lean();

    await this.uploadsService.deleteImage(targetImage.url);

    return {
      message: 'Image deleted successfully',
      postId,
      imageId,
      images: (updated?.images ?? []).map(formatMediaItem),
    };
  }
}
