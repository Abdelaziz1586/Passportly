import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LikeDocument = HydratedDocument<Like>;

@Schema({ timestamps: true, collection: 'likes' })
export class Like {
  @Prop({
    type: Types.ObjectId,
    ref: 'BlogPost',
    required: true,
    index: true,
  })
  post: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;
}

export const LikeSchema = SchemaFactory.createForClass(Like);
LikeSchema.index({ post: 1, user: 1 }, { unique: true });
