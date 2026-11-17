import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserSessionDocument = HydratedDocument<UserSession>;

@Schema({ timestamps: true, collection: 'user_sessions' })
export class UserSession {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ required: true, unique: true })
  jti: string;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  revokedAt?: Date | null;

  @Prop({ trim: true })
  userAgent?: string;

  @Prop({ trim: true })
  ipAddress?: string;
}

export const UserSessionSchema = SchemaFactory.createForClass(UserSession);
UserSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
