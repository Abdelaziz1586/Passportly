import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccountStatus, ProviderType, Role } from '../../common/enums';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ModeratorAssignment,
  ModeratorAssignmentDocument,
} from '../users/schemas/moderator-assignment.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  AccountAssignmentInfoDto,
  AdminAccountItemDto,
  ListAccountsQueryDto,
  PaginatedAccountsResponseDto,
} from './dto/list-accounts-query.dto';

type LeanAccountUser = {
  _id: Types.ObjectId;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: Role;
  status: AccountStatus;
  isEmailVerified: boolean;
  mustChangePassword?: boolean;
  lastLoginAt?: Date;
  suspendedAt?: Date;
  suspendedReason?: string;
  deactivatedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

type PopulatedProviderRef = {
  _id: Types.ObjectId;
  name?: string;
  isActive?: boolean;
};

type LeanAssignment = {
  _id: Types.ObjectId;
  moderator: Types.ObjectId;
  providerType: ProviderType;
  airline?: PopulatedProviderRef | Types.ObjectId | null;
  hotel?: PopulatedProviderRef | Types.ObjectId | null;
  isActive: boolean;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPopulatedProvider(
  ref: PopulatedProviderRef | Types.ObjectId | null | undefined,
): ref is PopulatedProviderRef {
  return (
    typeof ref === 'object' &&
    ref !== null &&
    '_id' in ref &&
    !('toHexString' in ref && typeof ref.toHexString === 'function')
  );
}

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
   * Lists platform user and moderator accounts with role, status, email/name
   * search filtering, sorting, pagination, and moderator provider assignment info.
   */
  async listAccounts(
    query: ListAccountsQueryDto,
  ): Promise<PaginatedAccountsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortDirection = query.sortOrder === 'asc' ? 1 : -1;

    const filter: Record<string, unknown> = {};
    if (query.role) {
      filter.role = query.role;
    }
    if (query.status) {
      filter.status = query.status;
    }
    if (query.search) {
      const tokens = query.search
        .trim()
        .split(/\s+/)
        .filter((token) => token.length > 0);
      if (tokens.length === 1) {
        const regex = new RegExp(escapeRegex(tokens[0]), 'i');
        filter.$or = [
          { email: regex },
          { firstName: regex },
          { lastName: regex },
        ];
      } else if (tokens.length > 1) {
        filter.$and = tokens.map((token) => {
          const regex = new RegExp(escapeRegex(token), 'i');
          return {
            $or: [{ email: regex }, { firstName: regex }, { lastName: regex }],
          };
        });
      }
    }

    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .select(
          '-passwordHash -emailVerificationToken -passwordResetToken -passwordResetExpiresAt',
        )
        .sort({ [sortBy]: sortDirection, _id: sortDirection })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanAccountUser[]>(),
      this.userModel.countDocuments(filter),
    ]);

    const moderatorIds = users
      .filter(
        (user) =>
          user.role === Role.AIRLINE_MODERATOR ||
          user.role === Role.HOTEL_MODERATOR,
      )
      .map((user) => user._id);

    const assignmentMap = new Map<string, AccountAssignmentInfoDto>();
    if (moderatorIds.length > 0) {
      const assignments = await this.moderatorAssignmentModel
        .find({ moderator: { $in: moderatorIds } })
        .populate('airline', 'name isActive')
        .populate('hotel', 'name isActive')
        .lean<LeanAssignment[]>();

      for (const assignment of assignments) {
        const providerRef =
          assignment.providerType === ProviderType.AIRLINE
            ? assignment.airline
            : assignment.hotel;
        if (!providerRef) continue;

        const providerId = isPopulatedProvider(providerRef)
          ? String(providerRef._id)
          : String(providerRef);
        const providerName = isPopulatedProvider(providerRef)
          ? providerRef.name
          : undefined;
        const providerIsActive = isPopulatedProvider(providerRef)
          ? providerRef.isActive
          : undefined;

        assignmentMap.set(String(assignment.moderator), {
          id: String(assignment._id),
          providerType: assignment.providerType,
          providerId,
          ...(providerName !== undefined ? { providerName } : {}),
          isActive: assignment.isActive,
          ...(providerIsActive !== undefined ? { providerIsActive } : {}),
        });
      }
    }

    return {
      data: users.map((user) =>
        this.toAccountItem(user, assignmentMap.get(String(user._id)) ?? null),
      ),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  private toAccountItem(
    user: LeanAccountUser,
    assignment: AccountAssignmentInfoDto | null,
  ): AdminAccountItemDto {
    const isModerator =
      user.role === Role.AIRLINE_MODERATOR ||
      user.role === Role.HOTEL_MODERATOR;

    return {
      id: String(user._id),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      ...(user.phone !== undefined ? { phone: user.phone } : {}),
      role: user.role,
      status: user.status,
      isEmailVerified: user.isEmailVerified,
      mustChangePassword: Boolean(user.mustChangePassword),
      ...(user.lastLoginAt !== undefined
        ? { lastLoginAt: user.lastLoginAt }
        : {}),
      ...(user.suspendedAt !== undefined
        ? { suspendedAt: user.suspendedAt }
        : {}),
      ...(user.suspendedReason !== undefined
        ? { suspendedReason: user.suspendedReason }
        : {}),
      ...(user.deactivatedAt !== undefined
        ? { deactivatedAt: user.deactivatedAt }
        : {}),
      ...(isModerator ? { assignment } : {}),
      ...(user.createdAt !== undefined ? { createdAt: user.createdAt } : {}),
      ...(user.updatedAt !== undefined ? { updatedAt: user.updatedAt } : {}),
    };
  }
}
