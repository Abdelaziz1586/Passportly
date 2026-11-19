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
import { UploadPostImageResponseDto } from './dto/blog-post-response.dto';
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
   * Validates author ownership, validates & stores the image via UploadsService,
   * and appends the resulting MediaItem to BlogPost.images.
   */
  async uploadPostImage(
    postId: string,
    userId: string,
    file?: Express.Multer.File,
  ): Promise<UploadPostImageResponseDto> {
    if (!isValidObjectId(postId)) {
      throw new BadRequestException('Invalid blog post ID');
    }
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    const post = await this.blogPostModel.findById(postId).lean();
    if (!post) {
      throw new NotFoundException('Blog post not found');
    }

    if (String(post.author) !== userId) {
      throw new ForbiddenException(
        'You can only upload images to your own blog posts',
      );
    }

    const mediaItem = await this.uploadsService.saveImage(file, 'blog-posts');

    try {
      const updated = await this.blogPostModel
        .findOneAndUpdate(
          { _id: post._id, author: new Types.ObjectId(userId) },
          { $push: { images: mediaItem } },
          { returnDocument: 'after' },
        )
        .lean();

      if (!updated) {
        await this.uploadsService.deleteImage(mediaItem.url);
        throw new NotFoundException('Blog post not found');
      }

      const images = (updated.images ?? []).map(formatMediaItem);
      const addedImage =
        images.find((img) => img.filename === mediaItem.filename) ??
        formatMediaItem(mediaItem);

      return {
        image: addedImage,
        images,
      };
    } catch (error) {
      await this.uploadsService.deleteImage(mediaItem.url);
      throw error;
    }
  }
}
