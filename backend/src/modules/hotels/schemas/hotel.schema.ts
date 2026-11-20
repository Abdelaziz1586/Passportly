import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import {
  MediaItem,
  MediaItemSchema,
} from '../../../common/schemas/media-item.schema';

export type HotelDocument = HydratedDocument<Hotel>;

@Schema({ _id: false })
export class HotelPolicy {
  @Prop({ trim: true, default: '15:00' })
  checkInTime: string;

  @Prop({ trim: true, default: '11:00' })
  checkOutTime: string;

  @Prop({ default: true })
  allowCancellation: boolean;

  @Prop({ type: Number, default: 2, min: 0 })
  freeCancellationDaysBeforeCheckIn: number;

  @Prop({ type: Number, default: 50, min: 0, max: 100 })
  cancellationFeePercentage: number;

  @Prop({ type: Number, default: 100, min: 0, max: 100 })
  noShowFeePercentage: number;

  @Prop({ default: true })
  childrenAllowed: boolean;

  @Prop({ default: false })
  petsAllowed: boolean;

  @Prop({ default: false })
  smokingAllowed: boolean;

  @Prop({ trim: true })
  termsText?: string;
}

export const HotelPolicySchema = SchemaFactory.createForClass(HotelPolicy);

@Schema({ timestamps: true, collection: 'hotels' })
export class Hotel {
  @Prop({ required: true, trim: true, index: true })
  name: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ type: Number, min: 1, max: 5, default: 3, index: true })
  starRating: number;

  @Prop({ required: true, trim: true })
  address: string;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'City',
    required: true,
    index: true,
  })
  city: Types.ObjectId;

  @Prop({ trim: true, index: true })
  cityName?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Country', index: true })
  country?: Types.ObjectId;

  @Prop({ uppercase: true, trim: true })
  countryCode?: string;

  @Prop({ type: Number })
  latitude?: number;

  @Prop({ type: Number })
  longitude?: number;

  @Prop({ type: [String], default: [] })
  amenities: string[];

  @Prop({ type: [MediaItemSchema], default: [] })
  images: MediaItem[];

  @Prop({ trim: true })
  contactEmail?: string;

  @Prop({ trim: true })
  contactPhone?: string;

  @Prop({ uppercase: true, trim: true, default: 'USD' })
  baseCurrency: string;

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({ type: Date })
  deactivatedAt?: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  deactivatedBy?: Types.ObjectId;

  @Prop({ type: HotelPolicySchema, default: () => ({}) })
  policies: HotelPolicy;

  @Prop({ type: Number, default: 0, min: 0, max: 5 })
  averageRating: number;

  @Prop({ type: Number, default: 0, min: 0 })
  reviewCount: number;
}

export const HotelSchema = SchemaFactory.createForClass(Hotel);
HotelSchema.index({ name: 'text', address: 'text', cityName: 'text' });
