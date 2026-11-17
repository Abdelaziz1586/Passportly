import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  MediaItem,
  MediaItemSchema,
} from '../../../common/schemas/media-item.schema';

export type RoomDocument = HydratedDocument<Room>;

@Schema({ timestamps: true, collection: 'rooms' })
export class Room {
  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true, index: true })
  hotel: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  roomType: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ required: true, min: 1 })
  maxOccupancy: number;

  @Prop({ type: Number, min: 1 })
  maxAdults?: number;

  @Prop({ type: Number, min: 0, default: 0 })
  maxChildren?: number;

  @Prop({ trim: true })
  bedConfiguration?: string;

  @Prop({ required: true, min: 0 })
  basePricePerNight: number;

  @Prop({ uppercase: true, trim: true, default: 'USD' })
  currency: string;

  @Prop({ required: true, min: 1, default: 1 })
  totalUnits: number;

  @Prop({ type: [String], default: [] })
  amenities: string[];

  @Prop({ type: [MediaItemSchema], default: [] })
  images: MediaItem[];

  @Prop({ default: true, index: true })
  isActive: boolean;
}

export const RoomSchema = SchemaFactory.createForClass(Room);
