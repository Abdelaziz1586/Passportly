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
  BookingStatus,
  BookingType,
  NotificationType,
  ProviderType,
  ReportStatus,
  ReportTargetType,
  Role,
} from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { BlogPost, BlogPostDocument } from '../blog/schemas/blog-post.schema';
import { Comment, CommentDocument } from '../blog/schemas/comment.schema';
import { Like, LikeDocument } from '../blog/schemas/like.schema';
import { Review, ReviewDocument } from '../hotels/schemas/review.schema';
import {
  Activity,
  ActivityDocument,
} from '../itineraries/schemas/activity.schema';
import {
  BudgetEntry,
  BudgetEntryDocument,
} from '../itineraries/schemas/budget-entry.schema';
import {
  Itinerary,
  ItineraryDocument,
} from '../itineraries/schemas/itinerary.schema';
import {
  TransportCost,
  TransportCostDocument,
} from '../itineraries/schemas/transport-cost.schema';
import { AuthService } from '../auth/auth.service';
import { Airline, AirlineDocument } from '../flights/schemas/airline.schema';
import {
  FlightBooking,
  FlightBookingDocument,
} from '../flights/schemas/flight-booking.schema';
import { Flight, FlightDocument } from '../flights/schemas/flight.schema';
import {
  HotelBooking,
  HotelBookingDocument,
} from '../hotels/schemas/hotel-booking.schema';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { Report, ReportDocument } from '../reports/schemas/report.schema';
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
import {
  AccountAssignmentInfoDto,
  AdminAccountItemDto,
  ListAccountsQueryDto,
  PaginatedAccountsResponseDto,
} from './dto/list-accounts-query.dto';
import {
  AdminBookingItemDto,
  ListAdminBookingsQueryDto,
  PaginatedAdminBookingsResponseDto,
} from './dto/list-admin-bookings-query.dto';
import { DeactivateProviderResponseDto } from './dto/deactivate-provider-response.dto';
import { ReactivateAccountResponseDto } from './dto/reactivate-account-response.dto';
import {
  AdminReportItemDto,
  ListReportsQueryDto,
  PaginatedReportsResponseDto,
  ReportUserSummaryDto,
} from './dto/list-reports-query.dto';
import { ReactivateProviderResponseDto } from './dto/reactivate-provider-response.dto';
import { DeleteContentResponseDto } from './dto/delete-content-response.dto';
import {
  ResolveReportDto,
  ResolveReportResponseDto,
} from './dto/resolve-report.dto';

const CONTENT_TYPE_MAP: Record<
  string,
  {
    targetType: ReportTargetType;
    entityLabel: string;
    slug: string;
    missingMessage: string;
  }
> = {
  blog_post: {
    targetType: ReportTargetType.BLOG_POST,
    entityLabel: 'BlogPost',
    slug: 'blog_post',
    missingMessage: 'Blog post not found',
  },
  comment: {
    targetType: ReportTargetType.COMMENT,
    entityLabel: 'Comment',
    slug: 'comment',
    missingMessage: 'Comment not found',
  },
  itinerary: {
    targetType: ReportTargetType.ITINERARY,
    entityLabel: 'Itinerary',
    slug: 'itinerary',
    missingMessage: 'Itinerary not found',
  },
  review: {
    targetType: ReportTargetType.REVIEW,
    entityLabel: 'Review',
    slug: 'review',
    missingMessage: 'Review not found',
  },
};
import {
  AccountStatusChangeResponseDto,
  SuspendAccountDto,
} from './dto/suspend-account.dto';

type AffectedBooking = {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  bookingReference: string;
  status: BookingStatus;
};

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

type PopulatedUser = {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  email?: string;
};

type LeanFlightBooking = {
  _id: Types.ObjectId;
  bookingReference: string;
  user: PopulatedUser | Types.ObjectId;
  tripType: string;
  legs: unknown[];
  passengerCounts: Record<string, unknown>;
  totalPrice: number;
  currency: string;
  status: BookingStatus;
  holdExpiresAt?: Date;
  confirmedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  refundAmount?: number;
  createdAt?: Date;
  updatedAt?: Date;
};

type LeanHotelBooking = {
  _id: Types.ObjectId;
  bookingReference: string;
  user: PopulatedUser | Types.ObjectId;
  hotel:
    { _id: Types.ObjectId; name?: string; cityName?: string } | Types.ObjectId;
  checkInDate: Date;
  checkOutDate: Date;
  nights: number;
  guestCount: number;
  rooms: unknown[];
  totalPrice: number;
  currency: string;
  status: BookingStatus;
  holdExpiresAt?: Date;
  confirmedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  refundAmount?: number;
  createdAt?: Date;
  updatedAt?: Date;
};

function formatUserRef(
  user: PopulatedUser | Types.ObjectId,
): Record<string, unknown> | string {
  if (user instanceof Types.ObjectId) {
    return user.toHexString();
  }
  if (
    typeof user === 'object' &&
    user !== null &&
    'email' in user &&
    typeof user.email === 'string'
  ) {
    return {
      id: user._id.toHexString(),
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    };
  }
  return user._id.toHexString();
}

type PopulatedReportUser = {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: Role;
  status?: AccountStatus;
};

type LeanReport = {
  _id: Types.ObjectId;
  reporter: PopulatedReportUser | Types.ObjectId;
  targetType: ReportTargetType;
  targetId: Types.ObjectId;
  reason: string;
  details?: string;
  status: ReportStatus;
  reviewedBy?: PopulatedReportUser | Types.ObjectId | null;
  reviewedAt?: Date;
  resolutionNotes?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

function formatReportUser(
  userRef: PopulatedReportUser | Types.ObjectId,
): ReportUserSummaryDto | string {
  if (userRef instanceof Types.ObjectId) {
    return userRef.toHexString();
  }
  if (
    typeof userRef === 'object' &&
    userRef !== null &&
    'email' in userRef &&
    typeof userRef.email === 'string'
  ) {
    return {
      id: userRef._id.toHexString(),
      ...(userRef.firstName !== undefined
        ? { firstName: userRef.firstName }
        : {}),
      ...(userRef.lastName !== undefined ? { lastName: userRef.lastName } : {}),
      email: userRef.email,
      ...(userRef.role !== undefined ? { role: userRef.role } : {}),
      ...(userRef.status !== undefined ? { status: userRef.status } : {}),
    };
  }
  return userRef._id.toHexString();
}

@Injectable()
export class AdminService {
  private static readonly BCRYPT_SALT_ROUNDS = 12;

  constructor(
    @InjectModel(User.name) readonly userModel: Model<UserDocument>,
    @InjectModel(ModeratorAssignment.name)
    readonly moderatorAssignmentModel: Model<ModeratorAssignmentDocument>,
    @InjectModel(Airline.name) readonly airlineModel: Model<AirlineDocument>,
    @InjectModel(Flight.name) readonly flightModel: Model<FlightDocument>,
    @InjectModel(FlightBooking.name)
    readonly flightBookingModel: Model<FlightBookingDocument>,
    @InjectModel(Hotel.name) readonly hotelModel: Model<HotelDocument>,
    @InjectModel(HotelBooking.name)
    readonly hotelBookingModel: Model<HotelBookingDocument>,
    @InjectModel(Report.name) readonly reportModel: Model<ReportDocument>,
    @InjectModel(BlogPost.name)
    readonly blogPostModel: Model<BlogPostDocument>,
    @InjectModel(Comment.name) readonly commentModel: Model<CommentDocument>,
    @InjectModel(Like.name) readonly likeModel: Model<LikeDocument>,
    @InjectModel(Itinerary.name)
    readonly itineraryModel: Model<ItineraryDocument>,
    @InjectModel(Activity.name) readonly activityModel: Model<ActivityDocument>,
    @InjectModel(BudgetEntry.name)
    readonly budgetEntryModel: Model<BudgetEntryDocument>,
    @InjectModel(TransportCost.name)
    readonly transportCostModel: Model<TransportCostDocument>,
    @InjectModel(Review.name) readonly reviewModel: Model<ReviewDocument>,
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
  /**
   * Deactivates an Airline or Hotel provider (hiding it from search and new
   * bookings while preserving existing CONFIRMED bookings), notifies assigned
   * moderators and travelers with active bookings, and records an AuditLog.
   */
  async deactivateProvider(
    rawType: string,
    providerId: string,
    admin: AuthenticatedUser,
    ipAddress?: string,
  ): Promise<DeactivateProviderResponseDto> {
    const providerType = this.parseProviderType(rawType);
    if (!isValidObjectId(providerId)) {
      throw new BadRequestException('Invalid provider ID');
    }

    const now = new Date();
    const adminObjectId = new Types.ObjectId(admin.userId);
    const isAirline = providerType === ProviderType.AIRLINE;
    const entityLabel = isAirline ? 'Airline' : 'Hotel';

    const provider = isAirline
      ? await this.airlineModel
          .findById(providerId)
          .select('_id name isActive')
          .lean()
      : await this.hotelModel
          .findById(providerId)
          .select('_id name isActive')
          .lean();

    if (!provider) {
      throw new NotFoundException(`${entityLabel} not found`);
    }

    if (!provider.isActive) {
      throw new ConflictException(`${entityLabel} is already deactivated`);
    }

    if (isAirline) {
      await this.airlineModel.findByIdAndUpdate(
        provider._id,
        {
          $set: {
            isActive: false,
            deactivatedAt: now,
            deactivatedBy: adminObjectId,
          },
        },
        { returnDocument: 'after' },
      );
    } else {
      await this.hotelModel.findByIdAndUpdate(
        provider._id,
        {
          $set: {
            isActive: false,
            deactivatedAt: now,
            deactivatedBy: adminObjectId,
          },
        },
        { returnDocument: 'after' },
      );
    }

    const assignmentFilter = isAirline
      ? {
          providerType: ProviderType.AIRLINE,
          airline: provider._id,
          isActive: true,
        }
      : {
          providerType: ProviderType.HOTEL,
          hotel: provider._id,
          isActive: true,
        };

    const moderatorAssignments = await this.moderatorAssignmentModel
      .find(assignmentFilter)
      .select('moderator')
      .lean();

    const activeStatuses = [
      BookingStatus.CONFIRMED,
      BookingStatus.HELD,
      BookingStatus.PENDING_PAYMENT,
    ];

    let affectedBookings: AffectedBooking[] = [];
    if (isAirline) {
      const flightIds = await this.flightModel.distinct('_id', {
        airline: provider._id,
      });
      if (flightIds.length > 0) {
        affectedBookings = await this.flightBookingModel
          .find({
            'legs.flight': { $in: flightIds },
            status: { $in: activeStatuses },
          })
          .select('_id user bookingReference status')
          .lean<AffectedBooking[]>();
      }
    } else {
      affectedBookings = await this.hotelBookingModel
        .find({
          hotel: provider._id,
          status: { $in: activeStatuses },
        })
        .select('_id user bookingReference status')
        .lean<AffectedBooking[]>();
    }

    await Promise.all(
      moderatorAssignments.map((assignment) =>
        this.notificationsService.createNotification({
          recipient: assignment.moderator,
          type: NotificationType.PROVIDER_DEACTIVATED,
          title: `${entityLabel} Provider Deactivated`,
          message: `${provider.name} has been deactivated by an administrator and hidden from public search and new bookings. Existing confirmed bookings remain valid.`,
          relatedEntityType: entityLabel,
          relatedEntityId: provider._id,
        }),
      ),
    );

    const bookingEntityType = isAirline ? 'FlightBooking' : 'HotelBooking';
    const notifiedTravelerIds = new Set<string>();
    await Promise.all(
      affectedBookings.map((booking) => {
        notifiedTravelerIds.add(String(booking.user));
        const statusNotice =
          booking.status === BookingStatus.CONFIRMED
            ? 'Your existing confirmed booking remains valid.'
            : 'Please review your booking status or contact support if needed.';
        return this.notificationsService.createNotification({
          recipient: booking.user,
          type: NotificationType.PROVIDER_DEACTIVATED,
          title: `${entityLabel} Deactivated Notice`,
          message: `${provider.name} has been deactivated for new bookings (Booking ${booking.bookingReference}). ${statusNotice}`,
          relatedEntityType: bookingEntityType,
          relatedEntityId: booking._id,
        });
      }),
    );

    await this.auditLogsService.log({
      actor: admin.userId,
      actorRole: admin.role,
      action: 'PROVIDER_DEACTIVATED',
      targetType: entityLabel,
      targetId: String(provider._id),
      details: {
        providerType,
        providerName: provider.name,
        moderatorsNotified: moderatorAssignments.length,
        bookingsNotifiedCount: affectedBookings.length,
        travelersNotified: notifiedTravelerIds.size,
      },
      ipAddress,
    });

    return {
      message: `${entityLabel} deactivated successfully`,
      id: String(provider._id),
      type: providerType,
      name: provider.name,
      isActive: false,
      deactivatedAt: now,
      moderatorsNotified: moderatorAssignments.length,
      travelersNotified: notifiedTravelerIds.size,
    };
  }

  /**
   * Reactivates a deactivated Airline or Hotel provider, notifies its assigned
   * moderator(s), and records a PROVIDER_REACTIVATED AuditLog.
   */
  async reactivateProvider(
    rawType: string,
    providerId: string,
    admin: AuthenticatedUser,
    ipAddress?: string,
  ): Promise<ReactivateProviderResponseDto> {
    const providerType = this.parseProviderType(rawType);
    if (!isValidObjectId(providerId)) {
      throw new BadRequestException('Invalid provider ID');
    }

    const isAirline = providerType === ProviderType.AIRLINE;
    const entityLabel = isAirline ? 'Airline' : 'Hotel';

    const provider = isAirline
      ? await this.airlineModel
          .findById(providerId)
          .select('_id name isActive')
          .lean()
      : await this.hotelModel
          .findById(providerId)
          .select('_id name isActive')
          .lean();

    if (!provider) {
      throw new NotFoundException(`${entityLabel} not found`);
    }

    if (provider.isActive) {
      throw new ConflictException(`${entityLabel} is already active`);
    }

    if (isAirline) {
      await this.airlineModel.findByIdAndUpdate(
        provider._id,
        {
          $set: { isActive: true },
          $unset: { deactivatedAt: 1, deactivatedBy: 1 },
        },
        { returnDocument: 'after' },
      );
    } else {
      await this.hotelModel.findByIdAndUpdate(
        provider._id,
        {
          $set: { isActive: true },
          $unset: { deactivatedAt: 1, deactivatedBy: 1 },
        },
        { returnDocument: 'after' },
      );
    }

    const assignmentFilter = isAirline
      ? {
          providerType: ProviderType.AIRLINE,
          airline: provider._id,
          isActive: true,
        }
      : {
          providerType: ProviderType.HOTEL,
          hotel: provider._id,
          isActive: true,
        };

    const moderatorAssignments = await this.moderatorAssignmentModel
      .find(assignmentFilter)
      .select('moderator')
      .lean();

    await Promise.all(
      moderatorAssignments.map((assignment) =>
        this.notificationsService.createNotification({
          recipient: assignment.moderator,
          type: NotificationType.PROVIDER_REACTIVATED,
          title: `${entityLabel} Provider Reactivated`,
          message: `${provider.name} has been reactivated by an administrator and is now visible in search and open for bookings.`,
          relatedEntityType: entityLabel,
          relatedEntityId: provider._id,
        }),
      ),
    );

    await this.auditLogsService.log({
      actor: admin.userId,
      actorRole: admin.role,
      action: 'PROVIDER_REACTIVATED',
      targetType: entityLabel,
      targetId: String(provider._id),
      details: {
        providerType,
        providerName: provider.name,
        moderatorsNotified: moderatorAssignments.length,
      },
      ipAddress,
    });

    return {
      message: `${entityLabel} reactivated successfully`,
      id: String(provider._id),
      type: providerType,
      name: provider.name,
      isActive: true,
      moderatorsNotified: moderatorAssignments.length,
    };
  }

  private parseProviderType(rawType: string): ProviderType {
    const normalized = rawType.trim().toLowerCase();
    if (
      normalized !== (ProviderType.AIRLINE as string) &&
      normalized !== (ProviderType.HOTEL as string)
    ) {
      throw new BadRequestException(
        'Provider type must be either airline or hotel',
      );
    }
    return normalized as ProviderType;
  }
  /**
   * Lists platform-wide flight and hotel bookings with filtering by bookingType,
   * status, userId, createdAt date range, sorting, and pagination.
   */
  async listPlatformBookings(
    query: ListAdminBookingsQueryDto,
  ): Promise<PaginatedAdminBookingsResponseDto> {
    if (query.fromDate && query.toDate && query.fromDate > query.toDate) {
      throw new BadRequestException(
        'fromDate must be before or equal to toDate',
      );
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortDirection = query.sortOrder === 'asc' ? 1 : -1;

    const filter: Record<string, unknown> = {};
    if (query.status) {
      filter.status = query.status;
    }
    if (query.userId) {
      if (!isValidObjectId(query.userId)) {
        throw new BadRequestException('Invalid userId');
      }
      filter.user = new Types.ObjectId(query.userId);
    }
    if (query.fromDate || query.toDate) {
      const createdAtRange: Record<string, Date> = {};
      if (query.fromDate) createdAtRange.$gte = query.fromDate;
      if (query.toDate) createdAtRange.$lte = query.toDate;
      filter.createdAt = createdAtRange;
    }

    const sortSpec: Record<string, 1 | -1> = {
      [sortBy]: sortDirection,
      _id: sortDirection,
    };

    if (query.bookingType === BookingType.FLIGHT) {
      const [items, total] = await Promise.all([
        this.flightBookingModel
          .find(filter)
          .populate('user', 'firstName lastName email')
          .populate('legs.flight', 'flightNumber departureTime arrivalTime')
          .sort(sortSpec)
          .skip((page - 1) * limit)
          .limit(limit)
          .lean<LeanFlightBooking[]>(),
        this.flightBookingModel.countDocuments(filter),
      ]);

      return {
        data: items.map((doc) => this.mapFlightBooking(doc)),
        total,
        page,
        limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      };
    }

    if (query.bookingType === BookingType.HOTEL) {
      const [items, total] = await Promise.all([
        this.hotelBookingModel
          .find(filter)
          .populate('user', 'firstName lastName email')
          .populate('hotel', 'name cityName')
          .sort(sortSpec)
          .skip((page - 1) * limit)
          .limit(limit)
          .lean<LeanHotelBooking[]>(),
        this.hotelBookingModel.countDocuments(filter),
      ]);

      return {
        data: items.map((doc) => this.mapHotelBooking(doc)),
        total,
        page,
        limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      };
    }

    const windowSize = page * limit;
    const [flightItems, hotelItems, flightTotal, hotelTotal] =
      await Promise.all([
        this.flightBookingModel
          .find(filter)
          .populate('user', 'firstName lastName email')
          .populate('legs.flight', 'flightNumber departureTime arrivalTime')
          .sort(sortSpec)
          .limit(windowSize)
          .lean<LeanFlightBooking[]>(),
        this.hotelBookingModel
          .find(filter)
          .populate('user', 'firstName lastName email')
          .populate('hotel', 'name cityName')
          .sort(sortSpec)
          .limit(windowSize)
          .lean<LeanHotelBooking[]>(),
        this.flightBookingModel.countDocuments(filter),
        this.hotelBookingModel.countDocuments(filter),
      ]);

    const combined = [
      ...flightItems.map((doc) => this.mapFlightBooking(doc)),
      ...hotelItems.map((doc) => this.mapHotelBooking(doc)),
    ].sort((a, b) => this.compareBookings(a, b, sortBy, sortDirection));

    const total = flightTotal + hotelTotal;
    const start = (page - 1) * limit;

    return {
      data: combined.slice(start, start + limit),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  private mapFlightBooking(doc: LeanFlightBooking): AdminBookingItemDto {
    return {
      id: String(doc._id),
      bookingType: BookingType.FLIGHT,
      bookingReference: doc.bookingReference,
      user: formatUserRef(doc.user),
      status: doc.status,
      totalPrice: doc.totalPrice,
      currency: doc.currency,
      details: {
        tripType: doc.tripType,
        passengerCounts: doc.passengerCounts,
        legs: doc.legs,
        ...(doc.holdExpiresAt !== undefined
          ? { holdExpiresAt: doc.holdExpiresAt }
          : {}),
        ...(doc.cancellationReason !== undefined
          ? { cancellationReason: doc.cancellationReason }
          : {}),
        ...(doc.refundAmount !== undefined
          ? { refundAmount: doc.refundAmount }
          : {}),
      },
      ...(doc.confirmedAt !== undefined
        ? { confirmedAt: doc.confirmedAt }
        : {}),
      ...(doc.cancelledAt !== undefined
        ? { cancelledAt: doc.cancelledAt }
        : {}),
      ...(doc.createdAt !== undefined ? { createdAt: doc.createdAt } : {}),
      ...(doc.updatedAt !== undefined ? { updatedAt: doc.updatedAt } : {}),
    };
  }

  private mapHotelBooking(doc: LeanHotelBooking): AdminBookingItemDto {
    return {
      id: String(doc._id),
      bookingType: BookingType.HOTEL,
      bookingReference: doc.bookingReference,
      user: formatUserRef(doc.user),
      status: doc.status,
      totalPrice: doc.totalPrice,
      currency: doc.currency,
      details: {
        hotel: doc.hotel,
        checkInDate: doc.checkInDate,
        checkOutDate: doc.checkOutDate,
        nights: doc.nights,
        guestCount: doc.guestCount,
        rooms: doc.rooms,
        ...(doc.holdExpiresAt !== undefined
          ? { holdExpiresAt: doc.holdExpiresAt }
          : {}),
        ...(doc.cancellationReason !== undefined
          ? { cancellationReason: doc.cancellationReason }
          : {}),
        ...(doc.refundAmount !== undefined
          ? { refundAmount: doc.refundAmount }
          : {}),
      },
      ...(doc.confirmedAt !== undefined
        ? { confirmedAt: doc.confirmedAt }
        : {}),
      ...(doc.cancelledAt !== undefined
        ? { cancelledAt: doc.cancelledAt }
        : {}),
      ...(doc.createdAt !== undefined ? { createdAt: doc.createdAt } : {}),
      ...(doc.updatedAt !== undefined ? { updatedAt: doc.updatedAt } : {}),
    };
  }

  private compareBookings(
    a: AdminBookingItemDto,
    b: AdminBookingItemDto,
    sortBy: 'createdAt' | 'updatedAt' | 'totalPrice' | 'status',
    direction: 1 | -1,
  ): number {
    let cmp = 0;
    if (sortBy === 'totalPrice') {
      cmp = a.totalPrice - b.totalPrice;
    } else if (sortBy === 'status') {
      cmp = a.status < b.status ? -1 : a.status > b.status ? 1 : 0;
    } else {
      const aVal = sortBy === 'updatedAt' ? a.updatedAt : a.createdAt;
      const bVal = sortBy === 'updatedAt' ? b.updatedAt : b.createdAt;
      const aTime = aVal ? new Date(aVal).getTime() : 0;
      const bTime = bVal ? new Date(bVal).getTime() : 0;
      cmp = aTime - bTime;
    }
    if (cmp !== 0) {
      return cmp * direction;
    }
    return (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) * direction;
  }
  /**
   * Lists submitted content moderation reports filtered by status and targetType
   * with reporter/reviewer details, sorting, and pagination.
   */
  async listReports(
    query: ListReportsQueryDto,
  ): Promise<PaginatedReportsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortDirection = query.sortOrder === 'asc' ? 1 : -1;

    const filter: Record<string, unknown> = {};
    if (query.status) {
      filter.status = query.status;
    }
    if (query.targetType) {
      filter.targetType = query.targetType;
    }

    const [reports, total] = await Promise.all([
      this.reportModel
        .find(filter)
        .populate('reporter', 'firstName lastName email role status')
        .populate('reviewedBy', 'firstName lastName email')
        .sort({ [sortBy]: sortDirection, _id: sortDirection })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanReport[]>(),
      this.reportModel.countDocuments(filter),
    ]);

    return {
      data: reports.map((doc) => this.toReportItem(doc)),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  private toReportItem(doc: LeanReport): AdminReportItemDto {
    return {
      id: doc._id.toHexString(),
      reporter: formatReportUser(doc.reporter),
      targetType: doc.targetType,
      targetId: doc.targetId.toHexString(),
      reason: doc.reason,
      ...(doc.details !== undefined ? { details: doc.details } : {}),
      status: doc.status,
      ...(doc.reviewedBy !== undefined
        ? {
            reviewedBy: doc.reviewedBy
              ? formatReportUser(doc.reviewedBy)
              : null,
          }
        : {}),
      ...(doc.reviewedAt !== undefined ? { reviewedAt: doc.reviewedAt } : {}),
      ...(doc.resolutionNotes !== undefined
        ? { resolutionNotes: doc.resolutionNotes }
        : {}),
      ...(doc.createdAt !== undefined ? { createdAt: doc.createdAt } : {}),
      ...(doc.updatedAt !== undefined ? { updatedAt: doc.updatedAt } : {}),
    };
  }
  /**
   * Resolves a pending content report (DISMISSED, CONTENT_HIDDEN, or CONTENT_DELETED),
   * performs the corresponding content moderation action, notifies author & reporter,
   * and writes an AuditLog entry.
   */
  async resolveReport(
    reportId: string,
    dto: ResolveReportDto,
    admin: AuthenticatedUser,
    ipAddress?: string,
  ): Promise<ResolveReportResponseDto> {
    if (!isValidObjectId(reportId)) {
      throw new BadRequestException('Invalid report ID');
    }

    const report = await this.reportModel.findById(reportId).lean();
    if (!report) {
      throw new NotFoundException('Report not found');
    }

    if (report.status !== ReportStatus.PENDING) {
      throw new ConflictException('Report has already been resolved');
    }

    let contentOwnerId: Types.ObjectId | undefined;
    if (dto.status === ReportStatus.CONTENT_HIDDEN) {
      contentOwnerId = await this.hideTargetContent(
        report.targetType,
        report.targetId,
      );
    } else if (dto.status === ReportStatus.CONTENT_DELETED) {
      contentOwnerId = await this.deleteTargetContent(
        report.targetType,
        report.targetId,
      );
    }

    const reviewedAt = new Date();
    const resolutionNotes = dto.resolutionNotes?.trim() || undefined;

    const updated = await this.reportModel
      .findOneAndUpdate(
        { _id: report._id, status: ReportStatus.PENDING },
        {
          $set: {
            status: dto.status,
            reviewedBy: new Types.ObjectId(admin.userId),
            reviewedAt,
            ...(resolutionNotes !== undefined ? { resolutionNotes } : {}),
          },
        },
        { returnDocument: 'after' },
      )
      .lean();

    if (!updated) {
      throw new ConflictException('Report has already been resolved');
    }

    await this.notifyModerationParties(
      report._id,
      report.targetType,
      report.targetId,
      report.reporter,
      contentOwnerId,
      dto.status,
    );

    await this.auditLogsService.log({
      actor: admin.userId,
      actorRole: admin.role,
      action: 'REPORT_RESOLVED',
      targetType: 'Report',
      targetId: String(report._id),
      details: {
        resolution: dto.status,
        reportTargetType: report.targetType,
        reportTargetId: String(report.targetId),
        ...(resolutionNotes !== undefined ? { resolutionNotes } : {}),
      },
      ipAddress,
    });

    return {
      id: String(updated._id),
      reporter: String(updated.reporter),
      targetType: updated.targetType,
      targetId: String(updated.targetId),
      reason: updated.reason,
      status: dto.status,
      reviewedBy: admin.userId,
      reviewedAt,
      ...(resolutionNotes !== undefined ? { resolutionNotes } : {}),
    };
  }

  private async hideTargetContent(
    targetType: ReportTargetType,
    targetId: Types.ObjectId,
  ): Promise<Types.ObjectId> {
    switch (targetType) {
      case ReportTargetType.BLOG_POST: {
        const post = await this.blogPostModel
          .findByIdAndUpdate(
            targetId,
            { $set: { isHidden: true } },
            { returnDocument: 'after' },
          )
          .select('author')
          .lean();
        if (!post) {
          throw new NotFoundException('Reported blog post not found');
        }
        return post.author;
      }
      case ReportTargetType.COMMENT: {
        const comment = await this.commentModel
          .findByIdAndUpdate(
            targetId,
            { $set: { isHidden: true } },
            { returnDocument: 'after' },
          )
          .select('author')
          .lean();
        if (!comment) {
          throw new NotFoundException('Reported comment not found');
        }
        return comment.author;
      }
      case ReportTargetType.ITINERARY: {
        const itinerary = await this.itineraryModel
          .findByIdAndUpdate(
            targetId,
            { $set: { isHidden: true } },
            { returnDocument: 'after' },
          )
          .select('user')
          .lean();
        if (!itinerary) {
          throw new NotFoundException('Reported itinerary not found');
        }
        return itinerary.user;
      }
      case ReportTargetType.REVIEW: {
        const review = await this.reviewModel
          .findByIdAndUpdate(
            targetId,
            { $set: { isHidden: true } },
            { returnDocument: 'after' },
          )
          .select('user hotel')
          .lean();
        if (!review) {
          throw new NotFoundException('Reported review not found');
        }
        await this.recalculateHotelRating(review.hotel);
        return review.user;
      }
    }
  }

  private async deleteTargetContent(
    targetType: ReportTargetType,
    targetId: Types.ObjectId,
  ): Promise<Types.ObjectId | undefined> {
    switch (targetType) {
      case ReportTargetType.BLOG_POST: {
        const post = await this.blogPostModel
          .findByIdAndDelete(targetId)
          .lean();
        if (!post) return undefined;
        await Promise.all([
          this.commentModel.deleteMany({ post: post._id }),
          this.likeModel.deleteMany({ post: post._id }),
        ]);
        return post.author;
      }
      case ReportTargetType.COMMENT: {
        const comment = await this.commentModel
          .findByIdAndDelete(targetId)
          .lean();
        if (!comment) return undefined;
        await this.blogPostModel.updateOne(
          { _id: comment.post, commentsCount: { $gt: 0 } },
          { $inc: { commentsCount: -1 } },
        );
        return comment.author;
      }
      case ReportTargetType.ITINERARY: {
        const itinerary = await this.itineraryModel
          .findByIdAndDelete(targetId)
          .lean();
        if (!itinerary) return undefined;
        await Promise.all([
          this.activityModel.deleteMany({ itinerary: itinerary._id }),
          this.budgetEntryModel.deleteMany({ itinerary: itinerary._id }),
          this.transportCostModel.deleteMany({ itinerary: itinerary._id }),
        ]);
        return itinerary.user;
      }
      case ReportTargetType.REVIEW: {
        const review = await this.reviewModel
          .findByIdAndDelete(targetId)
          .lean();
        if (!review) return undefined;
        await this.recalculateHotelRating(review.hotel);
        return review.user;
      }
    }
  }

  private async recalculateHotelRating(hotelId: Types.ObjectId): Promise<void> {
    const visibleReviews = await this.reviewModel
      .find({ hotel: hotelId, isHidden: false })
      .select('rating')
      .lean();
    const reviewCount = visibleReviews.length;
    const averageRating =
      reviewCount === 0
        ? 0
        : Number(
            (
              visibleReviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
            ).toFixed(2),
          );
    await this.hotelModel.updateOne(
      { _id: hotelId },
      { $set: { averageRating, reviewCount } },
    );
  }

  private async notifyModerationParties(
    reportId: Types.ObjectId,
    targetType: ReportTargetType,
    targetId: Types.ObjectId,
    reporterId: Types.ObjectId,
    ownerId: Types.ObjectId | undefined,
    resolution:
      | ReportStatus.DISMISSED
      | ReportStatus.CONTENT_HIDDEN
      | ReportStatus.CONTENT_DELETED,
  ): Promise<void> {
    const entityType = this.toEntityTypeLabel(targetType);
    const tasks: Promise<unknown>[] = [];

    if (
      resolution === ReportStatus.CONTENT_HIDDEN ||
      resolution === ReportStatus.CONTENT_DELETED
    ) {
      const actionLabel =
        resolution === ReportStatus.CONTENT_HIDDEN ? 'hidden' : 'deleted';

      if (ownerId) {
        tasks.push(
          this.notificationsService.createNotification({
            recipient: ownerId,
            type: NotificationType.MODERATION_ACTION,
            title: 'Content Moderation Notice',
            message: `Your ${entityType} was ${actionLabel} by an administrator following a content report.`,
            relatedEntityType: entityType,
            relatedEntityId: targetId,
          }),
        );
      }

      if (!ownerId || String(ownerId) !== String(reporterId)) {
        tasks.push(
          this.notificationsService.createNotification({
            recipient: reporterId,
            type: NotificationType.MODERATION_ACTION,
            title: 'Report Resolved',
            message: `Your report regarding a ${entityType} was reviewed and the content has been ${actionLabel}.`,
            relatedEntityType: 'Report',
            relatedEntityId: reportId,
          }),
        );
      }
    } else {
      tasks.push(
        this.notificationsService.createNotification({
          recipient: reporterId,
          type: NotificationType.MODERATION_ACTION,
          title: 'Report Reviewed',
          message: `Your report regarding a ${entityType} was reviewed and dismissed.`,
          relatedEntityType: 'Report',
          relatedEntityId: reportId,
        }),
      );
    }

    await Promise.all(tasks);
  }

  private toEntityTypeLabel(targetType: ReportTargetType): string {
    switch (targetType) {
      case ReportTargetType.BLOG_POST:
        return 'BlogPost';
      case ReportTargetType.COMMENT:
        return 'Comment';
      case ReportTargetType.ITINERARY:
        return 'Itinerary';
      case ReportTargetType.REVIEW:
        return 'Review';
    }
  }
  /**
   * Directly deletes inappropriate content by type and ID, cascades related
   * records, marks pending reports as CONTENT_DELETED, notifies owner, and audit logs.
   */
  async deleteContent(
    rawType: string,
    contentId: string,
    admin: AuthenticatedUser,
    ipAddress?: string,
  ): Promise<DeleteContentResponseDto> {
    const normalizedKey = rawType.trim().toLowerCase();
    const mapping = CONTENT_TYPE_MAP[normalizedKey];
    if (!mapping) {
      throw new BadRequestException(
        'Content type must be one of: blog_post, comment, itinerary, review',
      );
    }

    if (!isValidObjectId(contentId)) {
      throw new BadRequestException('Invalid content ID');
    }

    const targetObjectId = new Types.ObjectId(contentId);
    const ownerId = await this.deleteTargetContent(
      mapping.targetType,
      targetObjectId,
    );
    if (!ownerId) {
      throw new NotFoundException(mapping.missingMessage);
    }

    const now = new Date();
    const reportUpdate = await this.reportModel.updateMany(
      {
        targetType: mapping.targetType,
        targetId: targetObjectId,
        status: ReportStatus.PENDING,
      },
      {
        $set: {
          status: ReportStatus.CONTENT_DELETED,
          reviewedBy: new Types.ObjectId(admin.userId),
          reviewedAt: now,
          resolutionNotes: 'Content deleted directly by administrator',
        },
      },
    );

    await this.notificationsService.createNotification({
      recipient: ownerId,
      type: NotificationType.MODERATION_ACTION,
      title: 'Content Removed by Administrator',
      message: `Your ${mapping.entityLabel} was removed by an administrator for violating platform guidelines.`,
      relatedEntityType: mapping.entityLabel,
      relatedEntityId: targetObjectId,
    });

    await this.auditLogsService.log({
      actor: admin.userId,
      actorRole: admin.role,
      action: 'CONTENT_DELETED',
      targetType: mapping.entityLabel,
      targetId: contentId,
      details: {
        contentType: mapping.slug,
        ownerId: String(ownerId),
        resolvedPendingReports: reportUpdate.modifiedCount ?? 0,
      },
      ipAddress,
    });

    return {
      message: `${mapping.entityLabel} deleted successfully`,
      type: mapping.slug,
      id: contentId,
      ownerId: String(ownerId),
      resolvedPendingReports: reportUpdate.modifiedCount ?? 0,
    };
  }
}
