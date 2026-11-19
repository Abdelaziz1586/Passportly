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
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ModeratorAssignment,
  ModeratorAssignmentDocument,
} from '../users/schemas/moderator-assignment.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  AccountStatusChangeResponseDto,
  SuspendAccountDto,
} from './dto/suspend-account.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) readonly userModel: Model<UserDocument>,
    @InjectModel(ModeratorAssignment.name)
    readonly moderatorAssignmentModel: Model<ModeratorAssignmentDocument>,
    readonly auditLogsService: AuditLogsService,
    readonly notificationsService: NotificationsService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Suspends a user or moderator account (preventing self-suspension), revokes
   * active sessions, sends an in-app notification, and writes an audit log.
   */
  async suspendAccount(
    accountId: string,
    dto: SuspendAccountDto = {},
    admin: AuthenticatedUser,
    ipAddress?: string,
  ): Promise<AccountStatusChangeResponseDto> {
    if (!isValidObjectId(accountId)) {
      throw new BadRequestException('Invalid account ID');
    }

    if (accountId === admin.userId) {
      throw new BadRequestException(
        'Administrators cannot suspend their own account',
      );
    }

    const user = await this.userModel.findById(accountId).lean();
    if (!user) {
      throw new NotFoundException('Account not found');
    }

    if (user.status === AccountStatus.SUSPENDED) {
      throw new ConflictException('Account is already suspended');
    }

    const suspendedAt = new Date();
    const suspendedReason = dto?.reason?.trim() || 'Suspended by administrator';

    const updated = await this.userModel
      .findByIdAndUpdate(
        user._id,
        {
          $set: {
            status: AccountStatus.SUSPENDED,
            suspendedAt,
            suspendedReason,
          },
        },
        { returnDocument: 'after' },
      )
      .lean();

    const sessionsRevoked = await this.authService.revokeUserSessions(user._id);

    await this.notificationsService.createNotification({
      recipient: user._id,
      type: NotificationType.ACCOUNT_SUSPENDED,
      title: 'Account Suspended',
      message: `Your account has been suspended. Reason: ${suspendedReason}`,
      relatedEntityType: 'User',
      relatedEntityId: user._id,
    });

    await this.auditLogsService.log({
      actor: admin.userId,
      actorRole: admin.role,
      action: 'ACCOUNT_SUSPENDED',
      targetType: 'User',
      targetId: String(user._id),
      details: {
        email: user.email,
        role: user.role,
        previousStatus: user.status,
        reason: suspendedReason,
        sessionsRevoked,
      },
      ipAddress,
    });

    return {
      message: 'Account suspended successfully',
      id: String(user._id),
      email: updated?.email ?? user.email,
      role: updated?.role ?? user.role,
      status: updated?.status ?? AccountStatus.SUSPENDED,
      suspendedAt: updated?.suspendedAt ?? suspendedAt,
      suspendedReason: updated?.suspendedReason ?? suspendedReason,
      sessionsRevoked,
    };
  }
}
