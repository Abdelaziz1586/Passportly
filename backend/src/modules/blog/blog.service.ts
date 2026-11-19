import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { ItineraryVisibility } from '../../common/enums';
import {
  Itinerary,
  ItineraryDocument,
} from '../itineraries/schemas/itinerary.schema';
import { formatBlogPost, LeanBlogPostLike } from './blog.utils';
import { AttachItineraryDto } from './dto/attach-itinerary.dto';
import { BlogPostItemDto } from './dto/blog-post-response.dto';
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
    @InjectModel(Itinerary.name)
    readonly itineraryModel: Model<ItineraryDocument>,
  ) {}

  /**
   * Enforces post author ownership, verifies the target itinerary exists and
   * is public/accessible (or detaches if null), and updates BlogPost.attachedItinerary.
   */
  async attachItinerary(
    postId: string,
    userId: string,
    dto: AttachItineraryDto,
  ): Promise<BlogPostItemDto> {
    if (!isValidObjectId(postId)) {
      throw new BadRequestException('Invalid blog post ID');
    }

    const post = await this.blogPostModel.findById(postId).lean();
    if (!post) {
      throw new NotFoundException('Blog post not found');
    }

    if (String(post.author) !== userId) {
      throw new ForbiddenException(
        'You can only attach itineraries to your own blog posts',
      );
    }

    let nextItineraryId: Types.ObjectId | null = null;

    if (dto.itineraryId !== null) {
      const itinerary = await this.itineraryModel
        .findById(dto.itineraryId)
        .lean();
      if (!itinerary || itinerary.isHidden) {
        throw new NotFoundException('Itinerary not found');
      }

      if (itinerary.visibility !== ItineraryVisibility.PUBLIC) {
        if (String(itinerary.user) !== userId) {
          throw new ForbiddenException(
            'You do not have access to this private itinerary',
          );
        }
        throw new BadRequestException(
          'Only public itineraries can be attached to a blog post',
        );
      }

      nextItineraryId = itinerary._id;
    }

    const updated = await this.blogPostModel
      .findOneAndUpdate(
        { _id: post._id, author: new Types.ObjectId(userId) },
        { $set: { attachedItinerary: nextItineraryId } },
        { returnDocument: 'after' },
      )
      .lean<LeanBlogPostLike | null>();

    if (!updated) {
      throw new NotFoundException('Blog post not found');
    }

    return formatBlogPost(updated);
  }
}
