import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ _id: true })
export class MediaItem {
  _id?: Types.ObjectId;

  @Prop({ required: true })
  url: string;

  @Prop({ required: true })
  filename: string;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true, min: 0 })
  sizeBytes: number;

  @Prop({ default: () => new Date() })
  uploadedAt: Date;
}

export const MediaItemSchema = SchemaFactory.createForClass(MediaItem);
