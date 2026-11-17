import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ReviewDocument = HydratedDocument<Review>;

@Schema({ _id: false })
export class ModeratorReply {
  @Prop({ required: true, trim: true })
  replyText: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  repliedBy: Types.ObjectId;

  @Prop({ required: true, default: () => new Date() })
  repliedAt: Date;
}

export const ModeratorReplySchema =
  SchemaFactory.createForClass(ModeratorReply);

@Schema({ timestamps: true, collection: 'reviews' })
export class Review {
  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true, index: true })
  hotel: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'HotelBooking',
    required: true,
    unique: true,
  })
  booking: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ trim: true })
  title?: string;

  @Prop({ required: true, trim: true })
  comment: string;

  @Prop({ default: false, index: true })
  isHidden: boolean;

  @Prop({ type: ModeratorReplySchema, default: null })
  moderatorReply?: ModeratorReply | null;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);
