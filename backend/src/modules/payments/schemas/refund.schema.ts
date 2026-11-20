import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { BookingType, RefundStatus } from '../../../common/enums';

export type RefundDocument = HydratedDocument<Refund>;

@Schema({ timestamps: true, collection: 'refunds' })
export class Refund {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Payment',
    required: true,
    index: true,
  })
  payment: Types.ObjectId;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(BookingType),
    required: true,
  })
  bookingType: BookingType;

  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  bookingId: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true, uppercase: true, trim: true })
  currency: string;

  @Prop({ trim: true, index: true })
  stripeRefundId?: string;

  @Prop({ unique: true, sparse: true })
  providerCancellationKey?: string;

  @Prop({
    type: String,
    enum: Object.values(RefundStatus),
    default: RefundStatus.PENDING,
    index: true,
  })
  status: RefundStatus;

  @Prop({ trim: true })
  reason?: string;

  @Prop({ trim: true })
  policyCalculationNotes?: string;

  @Prop({ type: Date })
  processedAt?: Date;
}

export const RefundSchema = SchemaFactory.createForClass(Refund);
