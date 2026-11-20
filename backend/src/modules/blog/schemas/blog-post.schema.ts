import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { PostStatus } from '../../../common/enums';
import {
  MediaItem,
  MediaItemSchema,
} from '../../../common/schemas/media-item.schema';

export type BlogPostDocument = HydratedDocument<BlogPost>;

@Schema({ timestamps: true, collection: 'blog_posts' })
export class BlogPost {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  author: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ trim: true, index: true })
  slug?: string;

  @Prop({ required: true })
  content: string;

  @Prop({ trim: true })
  excerpt?: string;

  @Prop({
    type: String,
    enum: Object.values(PostStatus),
    default: PostStatus.DRAFT,
    index: true,
  })
  status: PostStatus;

  @Prop({ default: false, index: true })
  isHidden: boolean;

  @Prop({ type: [String], default: [], index: true })
  tags: string[];

  @Prop({ type: [{ type: SchemaTypes.ObjectId, ref: 'Tag' }], default: [] })
  tagRefs: Types.ObjectId[];

  @Prop({ type: [MediaItemSchema], default: [] })
  images: MediaItem[];

  @Prop({ type: Number, default: 0, min: 0 })
  likesCount: number;

  @Prop({ type: Number, default: 0, min: 0 })
  commentsCount: number;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Itinerary', default: null })
  attachedItinerary?: Types.ObjectId | null;

  @Prop({ type: Date, index: true })
  publishedAt?: Date;
}

export const BlogPostSchema = SchemaFactory.createForClass(BlogPost);
BlogPostSchema.index({ title: 'text', content: 'text', tags: 'text' });
