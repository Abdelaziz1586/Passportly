import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { AccountStatus, ProviderType, Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import {
  ModeratorAssignmentSummaryDto,
  UserProfileResponseDto,
} from './dto/user-profile-response.dto';
import {
  ModeratorAssignment,
  ModeratorAssignmentDocument,
} from './schemas/moderator-assignment.schema';
import { User, UserDocument } from './schemas/user.schema';

type LeanUserProfile = {
  _id: Types.ObjectId | string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatarUrl?: string;
  bio?: string;
  nationality?: string;
  preferredCurrency: string;
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

type LeanModeratorAssignment = {
  _id: Types.ObjectId | string;
  providerType: ProviderType;
  airline?: Types.ObjectId | string | null;
  hotel?: Types.ObjectId | string | null;
  assignedBy: Types.ObjectId | string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) readonly userModel: Model<UserDocument>,
    @InjectModel(ModeratorAssignment.name)
    readonly moderatorAssignmentModel: Model<ModeratorAssignmentDocument>,
  ) {}

  /**
   * Fetches the authenticated user's full profile (excluding passwordHash and
   * sensitive security/token fields) plus active moderator assignment when applicable.
   */
  async getMyProfile(
    currentUser: AuthenticatedUser,
  ): Promise<UserProfileResponseDto> {
    if (!isValidObjectId(currentUser.userId)) {
      throw new UnauthorizedException('Invalid authenticated user');
    }

    const user = await this.userModel
      .findById(currentUser.userId)
      .select(
        '-passwordHash -emailVerificationToken -passwordResetToken -passwordResetExpiresAt',
      )
      .lean<LeanUserProfile | null>();

    if (!user) {
      throw new NotFoundException('User account not found');
    }

    if (user.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(`Account is ${user.status.toLowerCase()}`);
    }

    let moderatorAssignment: ModeratorAssignmentSummaryDto | null | undefined;
    if (
      user.role === Role.AIRLINE_MODERATOR ||
      user.role === Role.HOTEL_MODERATOR
    ) {
      const assignment = await this.moderatorAssignmentModel
        .findOne({ moderator: user._id, isActive: true })
        .lean<LeanModeratorAssignment | null>();

      moderatorAssignment = assignment
        ? this.toAssignmentSummary(assignment)
        : null;
    }

    return this.toProfileResponse(user, moderatorAssignment);
  }

  private toAssignmentSummary(
    assignment: LeanModeratorAssignment,
  ): ModeratorAssignmentSummaryDto {
    const airlineId = assignment.airline
      ? String(assignment.airline)
      : undefined;
    const hotelId = assignment.hotel ? String(assignment.hotel) : undefined;
    const providerId = airlineId ?? hotelId;

    return {
      id: String(assignment._id),
      providerType: assignment.providerType,
      ...(providerId !== undefined ? { providerId } : {}),
      ...(airlineId !== undefined ? { airlineId } : {}),
      ...(hotelId !== undefined ? { hotelId } : {}),
      assignedBy: String(assignment.assignedBy),
      isActive: assignment.isActive,
      ...(assignment.createdAt !== undefined
        ? { createdAt: assignment.createdAt }
        : {}),
      ...(assignment.updatedAt !== undefined
        ? { updatedAt: assignment.updatedAt }
        : {}),
    };
  }

  private toProfileResponse(
    user: LeanUserProfile,
    moderatorAssignment?: ModeratorAssignmentSummaryDto | null,
  ): UserProfileResponseDto {
    return {
      id: String(user._id),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      ...(user.phone !== undefined ? { phone: user.phone } : {}),
      ...(user.avatarUrl !== undefined ? { avatarUrl: user.avatarUrl } : {}),
      ...(user.bio !== undefined ? { bio: user.bio } : {}),
      ...(user.nationality !== undefined
        ? { nationality: user.nationality }
        : {}),
      preferredCurrency: user.preferredCurrency,
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
      ...(moderatorAssignment !== undefined ? { moderatorAssignment } : {}),
      ...(user.createdAt !== undefined ? { createdAt: user.createdAt } : {}),
      ...(user.updatedAt !== undefined ? { updatedAt: user.updatedAt } : {}),
    };
  }
}
