import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type AttractionDocument = HydratedDocument<Attraction>;

@Schema({ timestamps: true, collection: 'attractions' })
export class Attraction {
  @Prop({ trim: true, index: true })
  externalId?: string;

  @Prop({ required: true, trim: true, index: true })
  name: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'City', index: true })
  city?: Types.ObjectId;

  @Prop({ trim: true })
  cityName?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Country', index: true })
  country?: Types.ObjectId;

  @Prop({ uppercase: true, trim: true })
  countryCode?: string;

  @Prop({ trim: true, index: true })
  category?: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ type: Number })
  latitude?: number;

  @Prop({ type: Number })
  longitude?: number;

  @Prop({ type: Number, min: 0 })
  estimatedCost?: number;

  @Prop({ trim: true })
  currency?: string;

  @Prop({ trim: true })
  imageUrl?: string;
}

export const AttractionSchema = SchemaFactory.createForClass(Attraction);
