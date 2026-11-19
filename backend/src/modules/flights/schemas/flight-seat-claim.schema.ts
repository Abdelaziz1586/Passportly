import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FlightSeatClaimDocument = HydratedDocument<FlightSeatClaim>;

/**
 * FLT-28: one passenger's seat on one leg of a booking. The claim collection is
 * the source of truth for "who sits where": two unique indexes make a seat
 * belong to one passenger per flight, and a passenger have one seat per leg,
 * even under concurrent requests. The arrays on the booking
 * (legs[].seatNumbers, passengers[].seatAssignments) are display copies written
 * in the same transaction. A claim exists only while its booking is active
 * (Confirmed or an unexpired hold): cancellation and expiry free the seats.
 */
@Schema({ timestamps: true, collection: 'flight_seat_claims' })
export class FlightSeatClaim {
  @Prop({ type: Types.ObjectId, ref: 'Flight', required: true })
  flight: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'CabinInventory', required: true })
  cabin: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'FlightBooking', required: true })
  booking: Types.ObjectId;

  /** _id of the leg subdocument inside the booking. */
  @Prop({ type: Types.ObjectId, required: true })
  leg: Types.ObjectId;

  /** _id of the passenger subdocument inside the booking. */
  @Prop({ type: Types.ObjectId, required: true })
  passenger: Types.ObjectId;

  /** Seat label such as "12C" (upper case). */
  @Prop({ type: String, required: true, uppercase: true, trim: true })
  seat: string;
}

export const FlightSeatClaimSchema =
  SchemaFactory.createForClass(FlightSeatClaim);

// One passenger per seat on a flight.
FlightSeatClaimSchema.index(
  { flight: 1, seat: 1 },
  { unique: true, name: 'seatClaim_one_passenger_per_seat' },
);
// One seat per passenger per leg; also serves "all seats of a booking".
FlightSeatClaimSchema.index(
  { booking: 1, leg: 1, passenger: 1 },
  { unique: true, name: 'seatClaim_one_seat_per_passenger_leg' },
);
