import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import {
  BookingType,
  PaymentPurpose,
  PaymentStatus,
} from '../../../common/enums';

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

  @Prop({ type: SchemaTypes.ObjectId, ref: 'FlightBooking', default: null })
  flightBooking?: Types.ObjectId | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'HotelBooking', default: null })
  hotelBooking?: Types.ObjectId | null;

  /**
   * What this payment pays for. Not set (older payments) means BOOKING. A
   * FLIGHT_CHANGE payment pays the fare difference of a change to a CONFIRMED
   * booking: it is linked through the two fields below and NOT through
   * `flightBooking`, so the one-live-payment-per-booking index does not apply.
   */
  @Prop({ type: String, enum: Object.values(PaymentPurpose) })
  purpose?: PaymentPurpose;

  /** FLT-27: the flight change this payment belongs to. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'FlightChange', default: null })
  flightChange?: Types.ObjectId | null;

  /** FLT-27: the (confirmed) flight booking being changed. */
  @Prop({ type: SchemaTypes.ObjectId, ref: 'FlightBooking', default: null })
  changedFlightBooking?: Types.ObjectId | null;

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

  /** The booking's hold end (fixed at creation, never extended): when it passes, open payments expire. */
  @Prop({ type: Date, index: true })
  holdExpiresAt?: Date;

  @Prop({ type: Date })
  paidAt?: Date;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);

/**
 * PAY-01: a booking has at most one payment in progress or paid (the fields above
 * must not also say `index: true`, or Mongoose drops this definition as a duplicate). Failed,
 * cancelled and expired payments do not count, so a new attempt is possible.
 */
const LIVE_PAYMENT_FILTER = {
  status: {
    $in: [
      PaymentStatus.PENDING,
      PaymentStatus.PROCESSING,
      PaymentStatus.FAILED,
      PaymentStatus.SUCCEEDED,
    ],
  },
};
// No plain {flightBooking}/{hotelBooking} index here: a shared database that ran the old schema already has
// flightBooking_1 / hotelBooking_1, and a second plain index on the same key with another name is rejected.
PaymentSchema.index(
  { flightBooking: 1 },
  {
    // Own name: an older plain flightBooking_1 index may already exist in a shared database.
    name: 'flightBooking_one_live_payment',
    unique: true,
    partialFilterExpression: {
      flightBooking: { $type: 'objectId' },
      ...LIVE_PAYMENT_FILTER,
    },
  },
);
PaymentSchema.index(
  { hotelBooking: 1 },
  {
    name: 'hotelBooking_one_live_payment',
    unique: true,
    partialFilterExpression: {
      hotelBooking: { $type: 'objectId' },
      ...LIVE_PAYMENT_FILTER,
    },
  },
);
