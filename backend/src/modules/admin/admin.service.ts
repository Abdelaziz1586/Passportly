import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { isValidObjectId, Model } from 'mongoose';
import { NotificationType } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthService } from '../auth/auth.service';
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

@Injectable()
export class AdminService {
  private static readonly BCRYPT_SALT_ROUNDS = 12;

  constructor(
    @InjectModel(User.name) readonly userModel: Model<UserDocument>,
    @InjectModel(ModeratorAssignment.name)
    readonly moderatorAssignmentModel: Model<ModeratorAssignmentDocument>,
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
}
