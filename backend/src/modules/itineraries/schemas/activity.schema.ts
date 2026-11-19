import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  MediaItem,
  MediaItemSchema,
} from '../../../common/schemas/media-item.schema';

export type ActivityDocument = HydratedDocument<Activity>;

@Schema({ timestamps: true, collection: 'activities' })
export class Activity {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Itinerary',
    required: true,
    index: true,
  })
  itinerary: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  dayId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ trim: true })
  category?: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Attraction',
    default: null,
  })
  attraction?: Types.ObjectId | null;

  @Prop({ trim: true })
  locationName?: string;

  @Prop({ trim: true })
  startTime?: string;

  @Prop({ trim: true })
  endTime?: string;

  @Prop({ type: Number, default: 0, min: 0 })
  orderIndex: number;

  @Prop({ type: [MediaItemSchema], default: [] })
  images: MediaItem[];
}

export const ActivitySchema = SchemaFactory.createForClass(Activity);
ActivitySchema.index({ itinerary: 1, dayId: 1, orderIndex: 1 });
