import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { CabinClass } from '../../../common/enums';

export type CabinInventoryDocument = HydratedDocument<CabinInventory>;

@Schema({ timestamps: true, collection: 'cabin_inventories' })
export class CabinInventory {
  @Prop({ type: Types.ObjectId, ref: 'Flight', required: true, index: true })
  flight: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(CabinClass),
    required: true,
  })
  cabinClass: CabinClass;

  @Prop({ required: true, min: 0 })
  totalSeats: number;

  @Prop({ required: true, min: 0 })
  availableSeats: number;

  @Prop({ default: 0, min: 0 })
  heldSeats: number;

  @Prop({ required: true, min: 0 })
  basePrice: number;

  @Prop({ type: Number, min: 0 })
  childPrice?: number;

  @Prop({ type: Number, min: 0 })
  infantPrice?: number;

  @Prop({ uppercase: true, trim: true, default: 'USD' })
  currency: string;

  @Prop({ type: Number, min: 0 })
  checkedBagsIncludedOverride?: number;

  @Prop({ type: Number, min: 0 })
  checkedBagMaxWeightKgOverride?: number;

  @Prop({ default: true })
  isActive: boolean;
}

export const CabinInventorySchema =
  SchemaFactory.createForClass(CabinInventory);
CabinInventorySchema.index({ flight: 1, cabinClass: 1 }, { unique: true });
