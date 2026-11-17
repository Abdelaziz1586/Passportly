import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AirlineDocument = HydratedDocument<Airline>;

@Schema({ _id: false })
export class AirlineBaggagePolicy {
  @Prop({ type: Number, default: 1, min: 0 })
  carryOnBagsIncluded: number;

  @Prop({ type: Number, default: 7, min: 0 })
  carryOnMaxWeightKg: number;

  @Prop({ trim: true })
  carryOnMaxDimensions?: string;

  @Prop({ type: Number, default: 1, min: 0 })
  checkedBagsIncluded: number;

  @Prop({ type: Number, default: 23, min: 0 })
  checkedBagMaxWeightKg: number;

  @Prop({ type: Number, default: 50, min: 0 })
  extraBagFee: number;

  @Prop({ type: Number, default: 15, min: 0 })
  overweightFeePerKg: number;

  @Prop({ uppercase: true, trim: true, default: 'USD' })
  currency: string;

  @Prop({ trim: true })
  notes?: string;
}

export const AirlineBaggagePolicySchema =
  SchemaFactory.createForClass(AirlineBaggagePolicy);

@Schema({ _id: false })
export class AirlineCancellationPolicy {
  @Prop({ default: true })
  allowCancellation: boolean;

  @Prop({ type: Number, default: 24, min: 0 })
  freeCancellationHoursBeforeDeparture: number;

  @Prop({ type: Number, default: 20, min: 0, max: 100 })
  cancellationFeePercentage: number;

  @Prop({ type: Number, default: 0, min: 0 })
  fixedCancellationFee: number;

  @Prop({ type: Number, default: 0, min: 0, max: 100 })
  refundPercentageAfterCutoff: number;

  @Prop({ uppercase: true, trim: true, default: 'USD' })
  currency: string;

  @Prop({ trim: true })
  termsText?: string;
}

export const AirlineCancellationPolicySchema = SchemaFactory.createForClass(
  AirlineCancellationPolicy,
);

@Schema({ timestamps: true, collection: 'airlines' })
export class Airline {
  @Prop({ required: true, trim: true, index: true })
  name: string;

  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  iataCode: string;

  @Prop({ uppercase: true, trim: true })
  icaoCode?: string;

  @Prop({ trim: true })
  logoUrl?: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ type: Types.ObjectId, ref: 'Country' })
  country?: Types.ObjectId;

  @Prop({ trim: true })
  contactEmail?: string;

  @Prop({ trim: true })
  contactPhone?: string;

  @Prop({ trim: true })
  website?: string;

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({ type: Date })
  deactivatedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  deactivatedBy?: Types.ObjectId;

  @Prop({ type: AirlineBaggagePolicySchema, default: () => ({}) })
  baggagePolicy: AirlineBaggagePolicy;

  @Prop({ type: AirlineCancellationPolicySchema, default: () => ({}) })
  cancellationPolicy: AirlineCancellationPolicy;
}

export const AirlineSchema = SchemaFactory.createForClass(Airline);
