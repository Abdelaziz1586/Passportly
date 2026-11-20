import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { ReportStatus, ReportTargetType } from '../../../common/enums';

export type ReportDocument = HydratedDocument<Report>;

@Schema({ timestamps: true, collection: 'reports' })
export class Report {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  reporter: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(ReportTargetType),
    required: true,
    index: true,
  })
  targetType: ReportTargetType;

  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  targetId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  reason: string;

  @Prop({ trim: true })
  details?: string;

  @Prop({
    type: String,
    enum: Object.values(ReportStatus),
    default: ReportStatus.PENDING,
    index: true,
  })
  status: ReportStatus;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  reviewedBy?: Types.ObjectId | null;

  @Prop({ type: Date })
  reviewedAt?: Date;

  @Prop({ trim: true })
  resolutionNotes?: string;
}

export const ReportSchema = SchemaFactory.createForClass(Report);
ReportSchema.index({ targetType: 1, targetId: 1 });
