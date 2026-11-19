import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type CityDocument = HydratedDocument<City>;

@Schema({ timestamps: true, collection: 'cities' })
export class City {
  @Prop({ trim: true, index: true })
  externalId?: string;

  @Prop({ required: true, trim: true, index: true })
  name: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Country',
    required: true,
    index: true,
  })
  country: Types.ObjectId;

  @Prop({ required: true, uppercase: true, trim: true, index: true })
  countryCode: string;

  @Prop({ type: Number })
  latitude?: number;

  @Prop({ type: Number })
  longitude?: number;

  @Prop({ trim: true })
  timezone?: string;
}

export const CitySchema = SchemaFactory.createForClass(City);
CitySchema.index({ name: 1, countryCode: 1 });
