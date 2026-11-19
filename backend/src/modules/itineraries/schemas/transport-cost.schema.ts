import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { TransportMode } from '../../../common/enums';

export type TransportCostDocument = HydratedDocument<TransportCost>;

@Schema({ timestamps: true, collection: 'transport_costs' })
export class TransportCost {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Itinerary',
    required: true,
    index: true,
  })
  itinerary: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'City', default: null })
  fromCity?: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'City', default: null })
  toCity?: Types.ObjectId | null;

  @Prop({ trim: true })
  fromCityName?: string;

  @Prop({ trim: true })
  toCityName?: string;

  @Prop({
    type: String,
    enum: Object.values(TransportMode),
    default: TransportMode.OTHER,
  })
  mode: TransportMode;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  departureDayId?: Types.ObjectId | null;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true, uppercase: true, trim: true })
  currency: string;

  @Prop({ trim: true })
  notes?: string;
}

export const TransportCostSchema = SchemaFactory.createForClass(TransportCost);
