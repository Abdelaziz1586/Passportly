import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { ItineraryVisibility } from '../../../common/enums';

export type ItineraryDocument = HydratedDocument<Itinerary>;

@Schema({ _id: true })
export class ItineraryDay {
  _id?: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  dayNumber: number;

  @Prop({ required: true })
  date: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'City', default: null })
  city?: Types.ObjectId | null;

  @Prop({ trim: true })
  cityName?: string;

  @Prop({ trim: true })
  title?: string;

  @Prop({ trim: true })
  notes?: string;
}

export const ItineraryDaySchema = SchemaFactory.createForClass(ItineraryDay);

@Schema({ timestamps: true, collection: 'itineraries' })
export class Itinerary {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  title: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ type: [{ type: SchemaTypes.ObjectId, ref: 'Country' }], default: [] })
  countries: Types.ObjectId[];

  @Prop({ required: true, index: true })
  startDate: Date;

  @Prop({ uppercase: true, trim: true, default: 'USD' })
  displayCurrency: string;

  @Prop({
    type: String,
    enum: Object.values(ItineraryVisibility),
    default: ItineraryVisibility.PRIVATE,
    index: true,
  })
  visibility: ItineraryVisibility;

  @Prop({ default: false, index: true })
  isHidden: boolean;

  @Prop({ type: [ItineraryDaySchema], default: [] })
  days: ItineraryDay[];

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Itinerary', default: null })
  clonedFromItinerary?: Types.ObjectId | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  clonedFromUser?: Types.ObjectId | null;

  @Prop({
    type: [{ type: SchemaTypes.ObjectId, ref: 'FlightBooking' }],
    default: [],
  })
  attachedFlightBookings: Types.ObjectId[];

  @Prop({
    type: [{ type: SchemaTypes.ObjectId, ref: 'HotelBooking' }],
    default: [],
  })
  attachedHotelBookings: Types.ObjectId[];

  @Prop({ trim: true })
  coverImageUrl?: string;

  @Prop({ type: Number, default: 0, min: 0 })
  cloneCount: number;
}

export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);
ItinerarySchema.index({ title: 'text', description: 'text' });
