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
  Role,
} from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
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
import { ReactivateProviderResponseDto } from './dto/reactivate-provider-response.dto';
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
}
