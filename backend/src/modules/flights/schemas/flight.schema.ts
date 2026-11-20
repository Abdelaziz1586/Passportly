import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { FlightStatus } from '../../../common/enums';

export type FlightDocument = HydratedDocument<Flight>;

@Schema({ timestamps: true, collection: 'flights' })
export class Flight {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Airline',
    required: true,
    index: true,
  })
  airline: Types.ObjectId;

  @Prop({ required: true, uppercase: true, trim: true, index: true })
  flightNumber: string;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Airport',
    required: true,
    index: true,
  })
  departureAirport: Types.ObjectId;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Airport',
    required: true,
    index: true,
  })
  arrivalAirport: Types.ObjectId;

  @Prop({ required: true, index: true })
  departureTime: Date;

  @Prop({ required: true })
  arrivalTime: Date;

  @Prop({ required: true, min: 1 })
  durationMinutes: number;

  @Prop()
  localDepartureDate?: string;

  @Prop({ default: 0 })
  bookingVersion: number;

  @Prop({ trim: true })
  aircraftType?: string;

  @Prop({
    type: String,
    enum: Object.values(FlightStatus),
    default: FlightStatus.SCHEDULED,
    index: true,
  })
  status: FlightStatus;

  @Prop({ trim: true })
  cancellationReason?: string;

  @Prop({ uppercase: true, trim: true, default: 'USD' })
  baseCurrency: string;

  @Prop({ type: Number, default: 0, min: 0 })
  stopsCount: number;
}

export const FlightSchema = SchemaFactory.createForClass(Flight);
FlightSchema.index({
  departureAirport: 1,
  arrivalAirport: 1,
  departureTime: 1,
  status: 1,
});
FlightSchema.index({ airline: 1, flightNumber: 1, departureTime: 1 });

FlightSchema.index(
  { airline: 1, flightNumber: 1, localDepartureDate: 1 },
  {
    unique: true,
    partialFilterExpression: { localDepartureDate: { $type: 'string' } },
  },
);
