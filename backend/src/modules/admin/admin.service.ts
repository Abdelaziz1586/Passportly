import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Model, Types } from 'mongoose';
import { AccountStatus, ProviderType, Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Airline, AirlineDocument } from '../flights/schemas/airline.schema';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ModeratorAssignment,
  ModeratorAssignmentDocument,
} from '../users/schemas/moderator-assignment.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
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
  ) {}

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
