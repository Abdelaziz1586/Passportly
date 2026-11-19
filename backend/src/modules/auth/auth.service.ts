import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Model } from 'mongoose';
import { AccountStatus, Role } from '../../common/enums';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { RegisterDto } from './dto/register.dto';
import { SafeUserResponseDto } from './dto/safe-user-response.dto';
import {
  UserSession,
  UserSessionDocument,
} from './schemas/user-session.schema';

type TimestampedUserDocument = UserDocument & {
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
export class AuthService {
  private static readonly BCRYPT_SALT_ROUNDS = 12;

  constructor(
    @InjectModel(User.name) readonly userModel: Model<UserDocument>,
    @InjectModel(UserSession.name)
    readonly sessionModel: Model<UserSessionDocument>,
    readonly jwtService: JwtService,
    readonly configService: ConfigService,
    private readonly referenceDataService: ReferenceDataService,
  ) {}

  /**
   * Registers a new traveler account with role REGISTERED_USER and returns
   * a sanitized user profile without sensitive fields.
   */
  async register(dto: RegisterDto): Promise<SafeUserResponseDto> {
    const email = dto.email.trim().toLowerCase();

    const existingUser = await this.userModel.exists({ email });
    if (existingUser) {
      throw new ConflictException('An account with this email already exists');
    }

    const preferredCurrency = dto.preferredCurrency
      ? dto.preferredCurrency.trim().toUpperCase()
      : 'USD';

    if (dto.preferredCurrency) {
      const supported =
        await this.referenceDataService.isCurrencySupported(preferredCurrency);
      if (!supported) {
        throw new BadRequestException(
          `Unsupported preferred currency: ${preferredCurrency}`,
        );
      }
    }

    const passwordHash = await bcrypt.hash(
      dto.password,
      AuthService.BCRYPT_SALT_ROUNDS,
    );

    const phone = dto.phone?.trim() || undefined;
    const nationality = dto.nationality?.trim().toUpperCase() || undefined;

    try {
      const createdUser = await this.userModel.create({
        email,
        passwordHash,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        ...(phone ? { phone } : {}),
        ...(nationality ? { nationality } : {}),
        preferredCurrency,
        role: Role.REGISTERED_USER,
        status: AccountStatus.ACTIVE,
        isEmailVerified: false,
      });

      return this.toSafeUser(createdUser);
    } catch (error: unknown) {
      if (isMongoDuplicateKeyError(error)) {
        throw new ConflictException(
          'An account with this email already exists',
        );
      }
      throw error;
    }
  }

  /**
   * Maps a User document to a public-safe response object, omitting passwordHash
   * and internal security/token fields.
   */
  toSafeUser(user: UserDocument): SafeUserResponseDto {
    const timestamped = user as TimestampedUserDocument;
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
      ...(timestamped.createdAt !== undefined
        ? { createdAt: timestamped.createdAt }
        : {}),
      ...(timestamped.updatedAt !== undefined
        ? { updatedAt: timestamped.updatedAt }
        : {}),
    };
  }
}
