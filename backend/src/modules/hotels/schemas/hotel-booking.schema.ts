import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { BookingStatus } from '../../../common/enums';

export type HotelBookingDocument = HydratedDocument<HotelBooking>;

@Schema({ _id: true })
export class BookedRoomItem {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Room', required: true })
  room: Types.ObjectId;

  @Prop({ required: true, trim: true })
  roomName: string;

  @Prop({ required: true, min: 1 })
  quantity: number;

  @Prop({ required: true, min: 0 })
  averagePricePerNight: number;

  @Prop({ required: true, min: 1 })
  nights: number;

  @Prop({ required: true, min: 0 })
  subtotal: number;

  @Prop({ type: Number, min: 1 })
  guestCount?: number;

  /** HTL-16: the adults assigned to this room. */
  @Prop({ type: Number, min: 0 })
  adults?: number;

  /** HTL-16: ages (0-17) of the children assigned to this room. */
  @Prop({ type: [Number], default: [] })
  childrenAges?: number[];
}

export const BookedRoomItemSchema =
  SchemaFactory.createForClass(BookedRoomItem);

@Schema({ timestamps: true, collection: 'hotel_bookings' })
export class HotelBooking {
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  bookingReference: string;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user: Types.ObjectId;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Hotel',
    required: true,
    index: true,
  })
  hotel: Types.ObjectId;

  @Prop({ type: [BookedRoomItemSchema], required: true })
  rooms: BookedRoomItem[];

  @Prop({ required: true, index: true })
  checkInDate: Date;

  @Prop({ required: true, index: true })
  checkOutDate: Date;

  @Prop({ required: true, min: 1 })
  nights: number;

  @Prop({ required: true, min: 1 })
  guestCount: number;

  @Prop({ required: true, trim: true })
  primaryGuestName: string;

  @Prop({ required: true, trim: true, lowercase: true })
  primaryGuestEmail: string;

  @Prop({ trim: true })
  primaryGuestPhone?: string;

  @Prop({ trim: true })
  specialRequests?: string;

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

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User' })
  policyAcceptedBy?: Types.ObjectId;

  @Prop({ type: Object })
  policySnapshot?: Record<string, unknown>;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Payment', default: null })
  payment?: Types.ObjectId | null;

  @Prop({ type: Date })
  confirmedAt?: Date;

  @Prop({ type: Date })
  cancelledAt?: Date;

  @Prop({ trim: true })
  cancellationReason?: string;

  @Prop({ type: Number, min: 0 })
  refundAmount?: number;
}

export const HotelBookingSchema = SchemaFactory.createForClass(HotelBooking);
HotelBookingSchema.index({ status: 1, holdExpiresAt: 1 });
HotelBookingSchema.index({ hotel: 1, checkInDate: 1, checkOutDate: 1 });
