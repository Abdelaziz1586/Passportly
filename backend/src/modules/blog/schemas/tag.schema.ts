import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TagDocument = HydratedDocument<Tag>;

@Schema({ timestamps: true, collection: 'tags' })
export class Tag {
  @Prop({ required: true, trim: true, lowercase: true })
  name: string;

  @Prop({ required: true, unique: true, trim: true, lowercase: true })
  slug: string;

  @Prop({ type: Number, default: 0, min: 0 })
  usageCount: number;
}

export const TagSchema = SchemaFactory.createForClass(Tag);
