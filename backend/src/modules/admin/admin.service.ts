import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { isValidObjectId, Model, Types } from 'mongoose';
import {
  AccountStatus,
  NotificationType,
  ProviderType,
  Role,
} from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthService } from '../auth/auth.service';
import { Airline, AirlineDocument } from '../flights/schemas/airline.schema';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ModeratorAssignment,
  ModeratorAssignmentDocument,
} from '../users/schemas/moderator-assignment.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  AdminResetPasswordDto,
  AdminResetPasswordResponseDto,
} from './dto/admin-reset-password.dto';
import {
  CreateModeratorDto,
  ModeratorResponseDto,
} from './dto/create-moderator.dto';

type TimestampedUser = UserDocument & {
  createdAt?: Date;
  updatedAt?: Date;
};

function isMongoDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

@Injectable()
export class AdminService {
  private static readonly BCRYPT_SALT_ROUNDS = 12;

  constructor(
    @InjectModel(User.name) readonly userModel: Model<UserDocument>,
    @InjectModel(ModeratorAssignment.name)
    readonly moderatorAssignmentModel: Model<ModeratorAssignmentDocument>,
    @InjectModel(Airline.name) readonly airlineModel: Model<AirlineDocument>,
    @InjectModel(Hotel.name) readonly hotelModel: Model<HotelDocument>,
    readonly auditLogsService: AuditLogsService,
    readonly notificationsService: NotificationsService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Sets a temporary password for a user, forces password change on next login,
   * revokes all active user sessions, notifies the user, and records an audit log.
   */
  async resetUserPassword(
    userId: string,
    dto: AdminResetPasswordDto,
    admin: AuthenticatedUser,
    ipAddress?: string,
  ): Promise<AdminResetPasswordResponseDto> {
    if (!isValidObjectId(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    if (userId === admin.userId) {
      throw new BadRequestException(
        'Use change-password to update your own password',
      );
    }

    const user = await this.userModel.findById(userId).lean();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const passwordHash = await bcrypt.hash(
      dto.temporaryPassword,
      AdminService.BCRYPT_SALT_ROUNDS,
    );

    await this.userModel.findByIdAndUpdate(
      user._id,
      {
        $set: {
          passwordHash,
          mustChangePassword: true,
          failedLoginAttempts: 0,
          lockoutUntil: null,
        },
        $unset: {
          passwordResetToken: 1,
          passwordResetExpiresAt: 1,
        },
      },
      { returnDocument: 'after' },
    );

    const sessionsRevoked = await this.authService.revokeUserSessions(user._id);

    await this.notificationsService.createNotification({
      recipient: user._id,
      type: NotificationType.SYSTEM,
      title: 'Temporary Password Set',
      message:
        'An administrator has reset your password. Sign in with your temporary password and change it immediately.',
      relatedEntityType: 'User',
      relatedEntityId: user._id,
    });

    await this.auditLogsService.log({
      actor: admin.userId,
      actorRole: admin.role,
      action: 'ADMIN_PASSWORD_RESET',
      targetType: 'User',
      targetId: String(user._id),
      details: {
        targetEmail: user.email,
        mustChangePassword: true,
        sessionsRevoked,
      },
      ipAddress,
    });

    return {
      message: 'Temporary password set successfully',
      userId: String(user._id),
      mustChangePassword: true,
      sessionsRevoked,
    };
  }
  /**
   * Creates an AIRLINE_MODERATOR or HOTEL_MODERATOR account linked to exactly
   * one Airline or Hotel via a unique ModeratorAssignment and records an AuditLog.
   */
  async createModerator(
    dto: CreateModeratorDto,
    admin: AuthenticatedUser,
    ipAddress?: string,
  ): Promise<ModeratorResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.userModel.exists({ email });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const providerType =
      dto.role === Role.AIRLINE_MODERATOR
        ? ProviderType.AIRLINE
        : ProviderType.HOTEL;

    const provider =
      providerType === ProviderType.AIRLINE
        ? await this.airlineModel
            .findById(dto.providerId)
            .select('_id name')
            .lean()
        : await this.hotelModel
            .findById(dto.providerId)
            .select('_id name')
            .lean();

    if (!provider) {
      throw new NotFoundException(
        providerType === ProviderType.AIRLINE
          ? 'Airline not found'
          : 'Hotel not found',
      );
    }

    const passwordHash = await bcrypt.hash(
      dto.password,
      AdminService.BCRYPT_SALT_ROUNDS,
    );
    const phone = dto.phone?.trim() || undefined;
    const mustChangePassword = dto.mustChangePassword ?? false;

    let createdUser: UserDocument;
    try {
      createdUser = await this.userModel.create({
        email,
        passwordHash,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        ...(phone ? { phone } : {}),
        role: dto.role,
        status: AccountStatus.ACTIVE,
        isEmailVerified: true,
        mustChangePassword,
      });
    } catch (error: unknown) {
      if (isMongoDuplicateKeyError(error)) {
        throw new ConflictException(
          'An account with this email already exists',
        );
      }
      throw error;
    }

    let assignment: ModeratorAssignmentDocument;
    try {
      assignment = await this.moderatorAssignmentModel.create({
        moderator: createdUser._id,
        providerType,
        airline: providerType === ProviderType.AIRLINE ? provider._id : null,
        hotel: providerType === ProviderType.HOTEL ? provider._id : null,
        assignedBy: new Types.ObjectId(admin.userId),
        isActive: true,
      });
    } catch (error: unknown) {
      await this.userModel
        .deleteOne({ _id: createdUser._id })
        .catch(() => undefined);
      if (isMongoDuplicateKeyError(error)) {
        throw new ConflictException(
          'Moderator already has an active provider assignment',
        );
      }
      throw error;
    }

    await this.auditLogsService.log({
      actor: admin.userId,
      actorRole: admin.role,
      action: 'MODERATOR_CREATED',
      targetType: 'User',
      targetId: String(createdUser._id),
      details: {
        email: createdUser.email,
        role: createdUser.role,
        providerType,
        providerId: String(provider._id),
        providerName: provider.name,
        assignmentId: String(assignment._id),
      },
      ipAddress,
    });

    const timestamped = createdUser as TimestampedUser;
    return {
      id: String(createdUser._id),
      email: createdUser.email,
      firstName: createdUser.firstName,
      lastName: createdUser.lastName,
      ...(createdUser.phone !== undefined ? { phone: createdUser.phone } : {}),
      role: createdUser.role,
      status: createdUser.status,
      isEmailVerified: createdUser.isEmailVerified,
      mustChangePassword: Boolean(createdUser.mustChangePassword),
      assignment: {
        id: String(assignment._id),
        providerType,
        providerId: String(provider._id),
        providerName: provider.name,
        isActive: assignment.isActive,
      },
      ...(timestamped.createdAt !== undefined
        ? { createdAt: timestamped.createdAt }
        : {}),
      ...(timestamped.updatedAt !== undefined
        ? { updatedAt: timestamped.updatedAt }
        : {}),
    };
  }
}
