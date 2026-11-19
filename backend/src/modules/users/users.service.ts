import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { AccountStatus, Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserProfileResponseDto } from './dto/user-profile-response.dto';
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
  createdAt?: Date;
  updatedAt?: Date;
};

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) readonly userModel: Model<UserDocument>,
    @InjectModel(ModeratorAssignment.name)
    readonly moderatorAssignmentModel: Model<ModeratorAssignmentDocument>,
    private readonly referenceDataService: ReferenceDataService,
  ) {}

  /**
   * Updates allowed profile fields for the authenticated user, validating
   * preferredCurrency against seeded Countries.csv and forbidding role/status edits.
   */
  async updateMyProfile(
    currentUser: AuthenticatedUser,
    dto: UpdateProfileDto,
  ): Promise<UserProfileResponseDto> {
    if (!isValidObjectId(currentUser.userId)) {
      throw new UnauthorizedException('Invalid authenticated user');
    }

    const rawInput = dto as unknown as Record<string, unknown>;
    if ('role' in rawInput || 'status' in rawInput) {
      throw new ForbiddenException(
        'Editing role or account status is forbidden',
      );
    }

    const existingUser = await this.userModel
      .findById(currentUser.userId)
      .select(
        '-passwordHash -emailVerificationToken -passwordResetToken -passwordResetExpiresAt',
      )
      .lean<LeanUserProfile | null>();

    if (!existingUser) {
      throw new NotFoundException('User account not found');
    }

    if (existingUser.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(
        `Account is ${existingUser.status.toLowerCase()}`,
      );
    }

    const setFields: Record<string, unknown> = {};
    const unsetFields: Record<string, 1> = {};

    if (dto.firstName !== undefined) {
      setFields.firstName = dto.firstName.trim();
    }
    if (dto.lastName !== undefined) {
      setFields.lastName = dto.lastName.trim();
    }
    if (dto.phone !== undefined) {
      const phone = dto.phone.trim();
      if (phone) {
        setFields.phone = phone;
      } else {
        unsetFields.phone = 1;
      }
    }
    if (dto.avatarUrl !== undefined) {
      const avatarUrl = dto.avatarUrl.trim();
      if (avatarUrl) {
        setFields.avatarUrl = avatarUrl;
      } else {
        unsetFields.avatarUrl = 1;
      }
    }
    if (dto.bio !== undefined) {
      const bio = dto.bio.trim();
      if (bio) {
        setFields.bio = bio;
      } else {
        unsetFields.bio = 1;
      }
    }
    if (dto.nationality !== undefined) {
      const nationality = dto.nationality.trim().toUpperCase();
      if (nationality) {
        setFields.nationality = nationality;
      } else {
        unsetFields.nationality = 1;
      }
    }
    if (dto.preferredCurrency !== undefined) {
      const currency = dto.preferredCurrency.trim().toUpperCase();
      const supported =
        await this.referenceDataService.isCurrencySupported(currency);
      if (!supported) {
        throw new BadRequestException(
          `Unsupported preferred currency: ${currency}`,
        );
      }
      setFields.preferredCurrency = currency;
    }

    const updateOps: Record<string, unknown> = {};
    if (Object.keys(setFields).length > 0) {
      updateOps.$set = setFields;
    }
    if (Object.keys(unsetFields).length > 0) {
      updateOps.$unset = unsetFields;
    }

    if (Object.keys(updateOps).length === 0) {
      return this.toProfileResponse(existingUser);
    }

    const updated = await this.userModel
      .findByIdAndUpdate(currentUser.userId, updateOps, {
        returnDocument: 'after',
      })
      .select(
        '-passwordHash -emailVerificationToken -passwordResetToken -passwordResetExpiresAt',
      )
      .lean<LeanUserProfile | null>();

    return this.toProfileResponse(updated ?? existingUser);
  }

  private toProfileResponse(user: LeanUserProfile): UserProfileResponseDto {
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
      ...(user.createdAt !== undefined ? { createdAt: user.createdAt } : {}),
      ...(user.updatedAt !== undefined ? { updatedAt: user.updatedAt } : {}),
    };
  }
}
