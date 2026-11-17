import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BudgetCategory } from '../../../common/enums';

export type BudgetEntryDocument = HydratedDocument<BudgetEntry>;

@Schema({ timestamps: true, collection: 'budget_entries' })
export class BudgetEntry {
  @Prop({
    type: Types.ObjectId,
    ref: 'Itinerary',
    required: true,
    index: true,
  })
  itinerary: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  dayId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(BudgetCategory),
    required: true,
    index: true,
  })
  category: BudgetCategory;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true, uppercase: true, trim: true })
  currency: string;
}

export const BudgetEntrySchema = SchemaFactory.createForClass(BudgetEntry);
