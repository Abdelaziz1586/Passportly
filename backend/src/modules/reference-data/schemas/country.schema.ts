import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CountryDocument = HydratedDocument<Country>;

@Schema({ timestamps: true, collection: 'countries' })
export class Country {
  @Prop({ trim: true, index: true })
  externalId?: string;

  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  code: string;

  @Prop({ required: true, trim: true, index: true })
  name: string;

  @Prop({ required: true, uppercase: true, trim: true, index: true })
  currencyCode: string;

  @Prop({ trim: true })
  currencyName?: string;

  @Prop({ trim: true })
  continent?: string;
}

export const CountrySchema = SchemaFactory.createForClass(Country);
