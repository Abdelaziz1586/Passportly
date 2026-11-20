import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type RoomAvailabilityDocument = HydratedDocument<RoomAvailability>;

@Schema({ timestamps: true, collection: 'room_availabilities' })
export class RoomAvailability {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Hotel',
    required: true,
    index: true,
  })
  hotel: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Room',
    required: true,
    index: true,
  })
  room: Types.ObjectId;

  /**
   * Stay night date normalized to UTC midnight (YYYY-MM-DDT00:00:00.000Z)
   */
  @Prop({ required: true, index: true })
  date: Date;

  @Prop({ required: true, min: 0 })
  totalUnits: number;

  @Prop({ default: 0, min: 0 })
  bookedUnits: number;

  @Prop({ default: 0, min: 0 })
  heldUnits: number;

  @Prop({ type: Number, min: 0, default: null })
  priceOverride?: number | null;

  @Prop({ default: false })
  isBlocked: boolean;

  @Prop({ trim: true })
  blockReason?: string;
}

export const RoomAvailabilitySchema =
  SchemaFactory.createForClass(RoomAvailability);
RoomAvailabilitySchema.index({ room: 1, date: 1 }, { unique: true });
RoomAvailabilitySchema.index({ hotel: 1, date: 1 });
