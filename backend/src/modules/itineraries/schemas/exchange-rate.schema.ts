import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ExchangeRateDocument = HydratedDocument<ExchangeRate>;

@Schema({ timestamps: true, collection: 'exchange_rates' })
export class ExchangeRate {
  @Prop({ required: true, uppercase: true, trim: true })
  baseCurrency: string;

  @Prop({ required: true, uppercase: true, trim: true })
  targetCurrency: string;

  @Prop({ required: true, min: 0 })
  rate: number;

  @Prop({ required: true })
  fetchedAt: Date;

  @Prop({ required: true, index: true })
  expiresAt: Date;

  @Prop({ default: 'FXRatesAPI', trim: true })
  source: string;
}

export const ExchangeRateSchema = SchemaFactory.createForClass(ExchangeRate);
ExchangeRateSchema.index(
  { baseCurrency: 1, targetCurrency: 1 },
  { unique: true },
);
