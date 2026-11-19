import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { PostStatus } from '../../common/enums';
import {
  buildExcerpt,
  formatBlogPost,
  generatePostSlug,
  LeanBlogPostLike,
  normalizeTags,
} from './blog.utils';
import { BlogPostItemDto } from './dto/blog-post-response.dto';
import { UpdatePostDto } from './dto/update-post.dto';
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
   * Updates a blog post owned by the authenticated author, synchronizes Tag
   * documents and usageCounts when tags change, and sets publishedAt on first publish.
   */
  async updatePost(
    postId: string,
    userId: string,
    dto: UpdatePostDto,
  ): Promise<BlogPostItemDto> {
    if (!isValidObjectId(postId)) {
      throw new BadRequestException('Invalid blog post ID');
    }

    const hasUpdates =
      dto.title !== undefined ||
      dto.content !== undefined ||
      dto.excerpt !== undefined ||
      dto.status !== undefined ||
      dto.tags !== undefined;
    if (!hasUpdates) {
      throw new BadRequestException('At least one field must be provided');
    }

    const post = await this.blogPostModel.findById(postId).lean();
    if (!post) {
      throw new NotFoundException('Blog post not found');
    }

    if (String(post.author) !== userId) {
      throw new ForbiddenException('You can only update your own blog posts');
    }

    const updateSet: Record<string, unknown> = {};

    if (dto.title !== undefined) {
      updateSet.title = dto.title;
      if (dto.title !== post.title) {
        updateSet.slug = generatePostSlug(dto.title);
      }
    }

    if (dto.content !== undefined) {
      updateSet.content = dto.content;
      if (dto.excerpt === undefined && !post.excerpt) {
        updateSet.excerpt = buildExcerpt(dto.content);
      }
    }

    if (dto.excerpt !== undefined) {
      updateSet.excerpt = dto.excerpt;
    }

    if (dto.status !== undefined) {
      updateSet.status = dto.status;
      if (dto.status === PostStatus.PUBLISHED && !post.publishedAt) {
        updateSet.publishedAt = new Date();
      }
    }

    if (dto.tags !== undefined) {
      const normalized = normalizeTags(dto.tags);
      const newTagDocs = await Promise.all(
        normalized.map((tag) =>
          this.tagModel
            .findOneAndUpdate(
              { slug: tag.slug },
              {
                $setOnInsert: {
                  name: tag.name,
                  slug: tag.slug,
                  usageCount: 0,
                },
              },
              { upsert: true, returnDocument: 'after' },
            )
            .lean(),
        ),
      );

      let existingTagIds = (post.tagRefs ?? []).map((id) => String(id));
      if (existingTagIds.length === 0 && (post.tags?.length ?? 0) > 0) {
        const legacyTags = await this.tagModel
          .find({ slug: { $in: post.tags } })
          .select('_id')
          .lean();
        existingTagIds = legacyTags.map((t) => String(t._id));
      }

      const oldSet = new Set(existingTagIds);
      const newSet = new Set(newTagDocs.map((t) => String(t._id)));

      const addedIds = newTagDocs
        .filter((t) => !oldSet.has(String(t._id)))
        .map((t) => t._id);
      const removedIds = existingTagIds
        .filter((id) => !newSet.has(id))
        .map((id) => new Types.ObjectId(id));

      if (addedIds.length > 0) {
        await this.tagModel.updateMany(
          { _id: { $in: addedIds } },
          { $inc: { usageCount: 1 } },
        );
      }

      if (removedIds.length > 0) {
        await this.tagModel.updateMany(
          { _id: { $in: removedIds }, usageCount: { $gt: 0 } },
          { $inc: { usageCount: -1 } },
        );
      }

      updateSet.tags = newTagDocs.map((t) => t.slug);
      updateSet.tagRefs = newTagDocs.map((t) => t._id);
    }

    const updated = await this.blogPostModel
      .findByIdAndUpdate(
        post._id,
        { $set: updateSet },
        { returnDocument: 'after' },
      )
      .lean<LeanBlogPostLike | null>();

    if (!updated) {
      throw new NotFoundException('Blog post not found');
    }

    return formatBlogPost(updated);
  }
}
