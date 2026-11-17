import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { AccountStatus, Role } from '../../../common/enums';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  })
  email: string;

  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({ required: true, trim: true })
  firstName: string;

  @Prop({ required: true, trim: true })
  lastName: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ trim: true })
  avatarUrl?: string;

  @Prop({ trim: true })
  bio?: string;

  @Prop({ uppercase: true, trim: true })
  nationality?: string;

  @Prop({ uppercase: true, trim: true, default: 'USD' })
  preferredCurrency: string;

  @Prop({
    type: String,
    enum: Object.values(Role),
    default: Role.REGISTERED_USER,
    index: true,
  })
  role: Role;

  @Prop({
    type: String,
    enum: Object.values(AccountStatus),
    default: AccountStatus.ACTIVE,
    index: true,
  })
  status: AccountStatus;

  @Prop({ default: false })
  isEmailVerified: boolean;

  @Prop({ select: false })
  emailVerificationToken?: string;

  @Prop({ select: false })
  passwordResetToken?: string;

  @Prop({ select: false })
  passwordResetExpiresAt?: Date;

  @Prop({ default: 0, min: 0 })
  failedLoginAttempts: number;

  @Prop({ type: Date, default: null })
  lockoutUntil?: Date | null;

  @Prop({ default: false })
  mustChangePassword: boolean;

  @Prop({ type: Date })
  lastLoginAt?: Date;

  @Prop({ type: Date })
  suspendedAt?: Date;

  @Prop({ trim: true })
  suspendedReason?: string;

  @Prop({ type: Date })
  deactivatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
