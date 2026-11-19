import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BookingType, RefundStatus } from '../../../common/enums';

export type RefundDocument = HydratedDocument<Refund>;

@Schema({ timestamps: true, collection: 'refunds' })
export class Refund {
  // No `index: true` here: the unique index below covers this key, and Mongoose
  // silently drops a second definition on the same key.
  @Prop({ type: Types.ObjectId, ref: 'Payment', required: true })
  payment: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(BookingType),
    required: true,
  })
  bookingType: BookingType;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  bookingId: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true, uppercase: true, trim: true })
  currency: string;

  @Prop({ trim: true, index: true })
  stripeRefundId?: string;

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

  /** Why Stripe refused or the retries gave up (status FAILED). */
  @Prop({ trim: true })
  failureReason?: string;

  /** How many times the Stripe call was tried. */
  @Prop({ type: Number, default: 0, min: 0 })
  attempts: number;
}

export const RefundSchema = SchemaFactory.createForClass(Refund);
// A payment is refunded at most once (a cancellation, or a payment that arrived after the hold).
RefundSchema.index(
  { payment: 1 },
  { name: 'payment_one_refund', unique: true },
);
// Looking a refund up from its booking.
RefundSchema.index(
  { bookingType: 1, bookingId: 1 },
  { name: 'booking_lookup' },
);
