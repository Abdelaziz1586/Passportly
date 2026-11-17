import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AirportDocument = HydratedDocument<Airport>;

@Schema({ timestamps: true, collection: 'airports' })
export class Airport {
  @Prop({ trim: true, index: true })
  externalId?: string;

  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  iataCode: string;

  @Prop({ uppercase: true, trim: true })
  icaoCode?: string;

  @Prop({ required: true, trim: true, index: true })
  name: string;

  @Prop({ type: Types.ObjectId, ref: 'City', index: true })
  city?: Types.ObjectId;

  @Prop({ trim: true, index: true })
  cityName?: string;

  @Prop({ type: Types.ObjectId, ref: 'Country', index: true })
  country?: Types.ObjectId;

  @Prop({ uppercase: true, trim: true, index: true })
  countryCode?: string;

  /**
   * IANA time zone identifier from Airports.csv (e.g., "Africa/Cairo", "Europe/London")
   */
  @Prop({ required: true, trim: true })
  timezone: string;

  @Prop({ type: Number })
  latitude?: number;

  @Prop({ type: Number })
  longitude?: number;
}

export const AirportSchema = SchemaFactory.createForClass(Airport);
AirportSchema.index({ name: 'text', iataCode: 'text', cityName: 'text' });
