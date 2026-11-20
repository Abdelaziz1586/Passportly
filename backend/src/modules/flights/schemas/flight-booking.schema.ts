import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  BookingStatus,
  CabinClass,
  PassengerType,
  TripType,
} from '../../../common/enums';

export type FlightBookingDocument = HydratedDocument<FlightBooking>;

@Schema({ _id: true })
export class FlightBookingLeg {
  @Prop({ type: Types.ObjectId, ref: 'Flight', required: true })
  flight: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'CabinInventory', required: true })
  cabin: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(CabinClass), required: true })
  cabinClass: CabinClass;

  @Prop({ required: true })
  departureTime: Date;

  @Prop({ required: true })
  arrivalTime: Date;

  @Prop({ required: true, min: 0 })
  unitPrice: number;

  @Prop({ type: [String], default: [] })
  seatNumbers: string[];

  /**
   * What this leg costs for the whole party (all passengers), written by FLT-27 when a leg is
   * changed so a later change can price it exactly. Bookings never changed do not have it.
   */
  @Prop({ type: Number, min: 0 })
  fare?: number;
}

export const FlightBookingLegSchema =
  SchemaFactory.createForClass(FlightBookingLeg);

@Schema({ _id: true })
export class Passenger {
  @Prop({ required: true, trim: true })
  firstName: string;

  @Prop({ required: true, trim: true })
  lastName: string;

  @Prop({
    type: String,
    enum: Object.values(PassengerType),
    default: PassengerType.ADULT,
  })
  type: PassengerType;

  @Prop({ type: Date })
  dateOfBirth?: Date;

  @Prop({ trim: true })
  gender?: string;

  @Prop({ trim: true })
  passportNumber?: string;

  @Prop({ type: Date })
  passportExpiry?: Date;

  @Prop({ uppercase: true, trim: true })
  nationality?: string;

  @Prop({ type: Number, default: 0, min: 0 })
  extraBaggageCount: number;

  @Prop({ type: Number, default: 0, min: 0 })
  extraBaggageFee: number;

  @Prop({ type: [String], default: [] })
  seatAssignments: string[];

  @Prop({ trim: true })
  eTicketNumber?: string;
}

export const PassengerSchema = SchemaFactory.createForClass(Passenger);

@Schema({ timestamps: true, collection: 'flight_bookings' })
export class FlightBooking {
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  bookingReference: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(TripType),
    default: TripType.ONE_WAY,
  })
  tripType: TripType;

  @Prop({ type: [FlightBookingLegSchema], required: true })
  legs: FlightBookingLeg[];

  @Prop({ type: [PassengerSchema], default: [] })
  passengers: Passenger[];

  @Prop({
    type: {
      adults: { type: Number, default: 1, min: 0 },
      children: { type: Number, default: 0, min: 0 },
      infants: { type: Number, default: 0, min: 0 },
      totalSeatsRequired: { type: Number, default: 1, min: 1 },
    },
    required: true,
  })
  passengerCounts: {
    adults: number;
    children: number;
    infants: number;
    totalSeatsRequired: number;
  };

  @Prop({ required: true, min: 0 })
  baseFareTotal: number;

  @Prop({ default: 0, min: 0 })
  extraBaggageTotal: number;

  @Prop({ default: 0, min: 0 })
  taxesAndFees: number;

  @Prop({ required: true, min: 0 })
  totalPrice: number;

  @Prop({ uppercase: true, trim: true, default: 'USD' })
  currency: string;

  @Prop({
    type: String,
    enum: Object.values(BookingStatus),
    default: BookingStatus.HELD,
    index: true,
  })
  status: BookingStatus;

  @Prop({ type: Date, index: true })
  holdExpiresAt?: Date;

  @Prop({ type: Date })
  policyAcceptedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  policyAcceptedBy?: Types.ObjectId;

  @Prop({ type: Object })
  policySnapshot?: Record<string, unknown>;

  @Prop({ type: Types.ObjectId, ref: 'Payment', default: null })
  payment?: Types.ObjectId | null;

  @Prop({ type: Date })
  confirmedAt?: Date;

  @Prop({ type: Date })
  cancelledAt?: Date;

  @Prop({ trim: true })
  cancellationReason?: string;

  @Prop({ type: Number, min: 0 })
  refundAmount?: number;

  /** FLT-27: how many times the flights of this confirmed booking were changed. */
  @Prop({ type: Number, default: 0, min: 0 })
  changeCount: number;

  /** FLT-27: payments of fare differences of applied changes, oldest first (besides `payment`). */
  @Prop({ type: [Types.ObjectId], ref: 'Payment', default: [] })
  changePayments: Types.ObjectId[];
}

export const FlightBookingSchema = SchemaFactory.createForClass(FlightBooking);
FlightBookingSchema.index({ status: 1, holdExpiresAt: 1 });
// FLT-25 listing: one user's bookings, optionally by status, newest first.
FlightBookingSchema.index({ user: 1, createdAt: -1 });
FlightBookingSchema.index({ user: 1, status: 1, createdAt: -1 });
