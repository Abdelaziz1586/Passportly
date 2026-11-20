import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FlightChangeDocument = HydratedDocument<FlightChange>;

export enum FlightChangeStatus {
  /** The fare difference is being paid; nothing on the booking changed yet. */
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  /** The booking now has the new flights. */
  APPLIED = 'APPLIED',
  /** The payment arrived but the change could not be applied: the difference was refunded. */
  FAILED = 'FAILED',
  /** Not paid in time. */
  EXPIRED = 'EXPIRED',
  /** Replaced by a newer change request of the same booking. */
  SUPERSEDED = 'SUPERSEDED',
}

/** What is stored of the change to apply once the difference is paid. */
export interface FlightChangePlan {
  /** The complete legs array the booking gets (unchanged legs keep their ids and seats). */
  legs: Array<Record<string, unknown>>;
  baseFareTotal: number;
  extraBaggageTotal: number;
  totalPrice: number;
  policySnapshot: Record<string, unknown>;
  replaced: Array<{
    legIndex: number;
    fromFlight: Types.ObjectId;
    fromLeg: Types.ObjectId;
    fromCabin: Types.ObjectId;
    toFlight: Types.ObjectId;
    toCabin: Types.ObjectId;
  }>;
  seatsRequired: number;
  /** The booking's changeCount when the change was quoted: the change only applies on top of that state. */
  baseChangeCount: number;
}

/**
 * FLT-27: one request to change the flight(s) of a CONFIRMED booking. Changes
 * that cost nothing extra are applied at once (recorded as APPLIED); a higher
 * fare is stored here as PENDING_PAYMENT together with the exact result, and
 * applied by the payment webhook when the fare difference was paid.
 */
@Schema({ timestamps: true, collection: 'flight_changes' })
export class FlightChange {
  @Prop({ type: Types.ObjectId, ref: 'FlightBooking', required: true })
  booking: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(FlightChangeStatus),
    default: FlightChangeStatus.PENDING_PAYMENT,
  })
  status: FlightChangeStatus;

  /** Total of the booking before and after, in major units; difference = new - old (can be negative). */
  @Prop({ required: true, min: 0 })
  oldTotal: number;

  @Prop({ required: true, min: 0 })
  newTotal: number;

  @Prop({ required: true })
  difference: number;

  @Prop({ required: true, uppercase: true, trim: true })
  currency: string;

  @Prop({ type: Object, required: true })
  plan: FlightChangePlan;

  @Prop({ type: Date, required: true })
  policyAcceptedAt: Date;

  /** The payment of the fare difference (only when the new fare is higher). */
  @Prop({ type: Types.ObjectId, ref: 'Payment', default: null })
  payment?: Types.ObjectId | null;

  /** When the offer to pay the difference ends. */
  @Prop({ type: Date })
  expiresAt?: Date;

  @Prop({ type: Date })
  appliedAt?: Date;

  @Prop({ trim: true })
  failureReason?: string;
}

export const FlightChangeSchema = SchemaFactory.createForClass(FlightChange);
// One change awaiting payment per booking.
FlightChangeSchema.index(
  { booking: 1 },
  {
    name: 'flightChange_one_pending_per_booking',
    unique: true,
    partialFilterExpression: { status: FlightChangeStatus.PENDING_PAYMENT },
  },
);
FlightChangeSchema.index(
  { booking: 1, createdAt: -1 },
  { name: 'flightChange_booking_history' },
);
