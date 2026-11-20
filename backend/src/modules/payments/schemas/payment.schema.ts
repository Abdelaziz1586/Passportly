import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { BookingType, PaymentStatus } from '../../../common/enums';

export type PaymentDocument = HydratedDocument<Payment>;

@Schema({ timestamps: true, collection: 'payments' })
export class Payment {
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
    index: true,
  })
  bookingType: BookingType;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'FlightBooking',
    default: null,
    index: true,
  })
  flightBooking?: Types.ObjectId | null;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'HotelBooking',
    default: null,
    index: true,
  })
  hotelBooking?: Types.ObjectId | null;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true, uppercase: true, trim: true })
  currency: string;

  @Prop({ default: 'stripe', trim: true })
  provider: string;

  @Prop({ trim: true, index: true })
  stripePaymentIntentId?: string;

  @Prop({ select: false })
  stripeClientSecret?: string;

  @Prop({
    type: String,
    enum: Object.values(PaymentStatus),
    default: PaymentStatus.PENDING,
    index: true,
  })
  status: PaymentStatus;

  @Prop({ trim: true })
  failureReason?: string;

  @Prop({ type: Date, required: true })
  policyAcceptedAt: Date;

  @Prop({ type: Date })
  paidAt?: Date;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
