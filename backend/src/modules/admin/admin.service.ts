import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { AccountStatus, NotificationType } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ModeratorAssignment,
  ModeratorAssignmentDocument,
} from '../users/schemas/moderator-assignment.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ReactivateAccountResponseDto } from './dto/reactivate-account-response.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) readonly userModel: Model<UserDocument>,
    @InjectModel(ModeratorAssignment.name)
    readonly moderatorAssignmentModel: Model<ModeratorAssignmentDocument>,
    readonly auditLogsService: AuditLogsService,
    readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Restores a suspended, deactivated, or locked-out account to AccountStatus.ACTIVE,
   * clears suspension/lockout flags, notifies the user, and records an AuditLog.
   */
  async reactivateAccount(
    accountId: string,
    admin: AuthenticatedUser,
    ipAddress?: string,
  ): Promise<ReactivateAccountResponseDto> {
    if (!isValidObjectId(accountId)) {
      throw new BadRequestException('Invalid account ID');
    }

    const user = await this.userModel.findById(accountId).lean();
    if (!user) {
      throw new NotFoundException('Account not found');
    }

    const hasLockoutState =
      Boolean(user.lockoutUntil) || (user.failedLoginAttempts ?? 0) > 0;
    if (user.status === AccountStatus.ACTIVE && !hasLockoutState) {
      throw new ConflictException('Account is already active');
    }

    const updated = await this.userModel
      .findByIdAndUpdate(
        user._id,
        {
          $set: {
            status: AccountStatus.ACTIVE,
            failedLoginAttempts: 0,
            lockoutUntil: null,
          },
          $unset: {
            suspendedAt: 1,
            suspendedReason: 1,
            deactivatedAt: 1,
          },
        },
        { returnDocument: 'after' },
      )
      .lean();

    await this.notificationsService.createNotification({
      recipient: user._id,
      type: NotificationType.ACCOUNT_REACTIVATED,
      title: 'Account Reactivated',
      message:
        'Your Passportly account has been reactivated by an administrator.',
      relatedEntityType: 'User',
      relatedEntityId: user._id,
    });

    await this.auditLogsService.log({
      actor: admin.userId,
      actorRole: admin.role,
      action: 'ACCOUNT_REACTIVATED',
      targetType: 'User',
      targetId: String(user._id),
      details: {
        email: user.email,
        role: user.role,
        previousStatus: user.status,
        clearedLockout: hasLockoutState,
      },
      ipAddress,
    });

    return {
      message: 'Account reactivated successfully',
      id: String(user._id),
      email: updated?.email ?? user.email,
      role: updated?.role ?? user.role,
      status: updated?.status ?? AccountStatus.ACTIVE,
      failedLoginAttempts: updated?.failedLoginAttempts ?? 0,
    };
  }
}
