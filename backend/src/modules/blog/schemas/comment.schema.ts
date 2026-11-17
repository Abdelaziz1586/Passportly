import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CommentDocument = HydratedDocument<Comment>;

@Schema({ timestamps: true, collection: 'comments' })
export class Comment {
  @Prop({
    type: Types.ObjectId,
    ref: 'BlogPost',
    required: true,
    index: true,
  })
  post: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  author: Types.ObjectId;

  @Prop({ required: true, trim: true })
  content: string;

  @Prop({ default: false, index: true })
  isHidden: boolean;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);
