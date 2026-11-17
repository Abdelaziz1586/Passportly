import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ProviderType } from '../../../common/enums';

export type ModeratorAssignmentDocument = HydratedDocument<ModeratorAssignment>;

@Schema({ timestamps: true, collection: 'moderator_assignments' })
export class ModeratorAssignment {
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  })
  moderator: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(ProviderType),
    required: true,
    index: true,
  })
  providerType: ProviderType;

  @Prop({ type: Types.ObjectId, ref: 'Airline', default: null, index: true })
  airline?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Hotel', default: null, index: true })
  hotel?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  assignedBy: Types.ObjectId;

  @Prop({ default: true })
  isActive: boolean;
}

export const ModeratorAssignmentSchema =
  SchemaFactory.createForClass(ModeratorAssignment);
