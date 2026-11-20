import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import type { CookieOptions } from 'express';
import { Model } from 'mongoose';
import { AccountStatus, Role } from '../../common/enums';
import type {
  AuthenticatedUser,
  JwtPayload,
} from '../../common/interfaces/jwt-payload.interface';
import { MailService } from '../mail/mail.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ForgotPasswordResponseDto } from './dto/forgot-password-response.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutResponseDto } from './dto/logout-response.dto';
import { RegisterDto } from './dto/register.dto';
import { SafeUserResponseDto } from './dto/safe-user-response.dto';
import { VerifyEmailQueryDto } from './dto/verify-email-query.dto';
import { VerifyEmailResponseDto } from './dto/verify-email-response.dto';
import {
  UserSession,
  UserSessionDocument,
} from './schemas/user-session.schema';

type TimestampedUserDocument = UserDocument & {
  createdAt?: Date;
  updatedAt?: Date;
};

export interface LoginContext {
  userAgent?: string;
  ipAddress?: string;
}

export interface LoginResult {
  response: LoginResponseDto;
  accessToken: string;
  cookieName: string;
  cookieOptions: CookieOptions;
}

export interface LogoutResult {
  response: LogoutResponseDto;
  cookieName: string;
  clearCookieOptions: CookieOptions;
}

function isMongoDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function parseExpiresInToMs(expiresIn: string): number {
  const trimmed = expiresIn.trim();
  const match = /^(\d+)(ms|s|m|h|d)?$/i.exec(trimmed);
  if (!match) {
    return 24 * 60 * 60 * 1000;
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return amount * (multipliers[unit] ?? 1000);
}

function extractJwtExpSeconds(decoded: unknown): number | undefined {
  if (
    typeof decoded === 'object' &&
    decoded !== null &&
    'exp' in decoded &&
    typeof (decoded as { exp?: unknown }).exp === 'number'
  ) {
    return (decoded as { exp: number }).exp;
  }
  return undefined;
}

@Injectable()
export class AuthService {
  private static readonly BCRYPT_SALT_ROUNDS = 12;
  private static readonly MAX_FAILED_LOGIN_ATTEMPTS = 5;
  private static readonly LOCKOUT_DURATION_MS = 15 * 60 * 1000;
  private static readonly PASSWORD_RESET_TTL_MINUTES = 15;
  private static readonly PASSWORD_RESET_TTL_MS =
    AuthService.PASSWORD_RESET_TTL_MINUTES * 60 * 1000;

  constructor(
    @InjectModel(User.name) readonly userModel: Model<UserDocument>,
    @InjectModel(UserSession.name)
    readonly sessionModel: Model<UserSessionDocument>,
    readonly jwtService: JwtService,
    readonly configService: ConfigService,
    private readonly referenceDataService: ReferenceDataService,
    private readonly mailService: MailService,
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
    const emailVerificationToken = randomBytes(32).toString('hex');

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
        emailVerificationToken,
      });

      await this.mailService.sendVerificationEmail({
        to: createdUser.email,
        firstName: createdUser.firstName,
        token: emailVerificationToken,
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
   * Validates an email verification token, marks the user's email as verified,
   * and clears the single-use verification token.
   */
  async verifyEmail(
    query: VerifyEmailQueryDto,
  ): Promise<VerifyEmailResponseDto> {
    const token = (query.emailVerificationToken ?? query.token)?.trim();
    if (!token) {
      throw new BadRequestException(
        'emailVerificationToken query parameter is required',
      );
    }

    const user = await this.userModel
      .findOne({ emailVerificationToken: token })
      .select('email status isEmailVerified');

    if (!user) {
      throw new BadRequestException(
        'Invalid or expired email verification token',
      );
    }

    if (user.status !== AccountStatus.ACTIVE) {
      throw new BadRequestException('Account is not active');
    }

    const updated = await this.userModel.findOneAndUpdate(
      { _id: user._id, emailVerificationToken: token },
      {
        $set: { isEmailVerified: true },
        $unset: { emailVerificationToken: 1 },
      },
      { returnDocument: 'after' },
    );

    if (!updated) {
      throw new BadRequestException(
        'Invalid or expired email verification token',
      );
    }

    return {
      message: 'Email address verified successfully',
      isEmailVerified: true,
      email: updated.email,
    };
  }

  /**
   * Authenticates a user, enforces failed-login lockout and AccountStatus.ACTIVE,
   * creates a tracked UserSession, signs a JWT, and returns cookie configuration.
   */
  async login(dto: LoginDto, context: LoginContext = {}): Promise<LoginResult> {
    const email = dto.email.trim().toLowerCase();
    const now = new Date();

    const user = await this.userModel
      .findOne({ email })
      .select('+passwordHash');

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.lockoutUntil && user.lockoutUntil > now) {
      throw new ForbiddenException(
        'Account is temporarily locked due to multiple failed login attempts. Please try again later.',
      );
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      const lockoutExpired =
        Boolean(user.lockoutUntil) && (user.lockoutUntil as Date) <= now;
      const baseAttempts = lockoutExpired ? 0 : (user.failedLoginAttempts ?? 0);
      const nextAttempts = baseAttempts + 1;
      const shouldLock = nextAttempts >= AuthService.MAX_FAILED_LOGIN_ATTEMPTS;
      const lockoutUntil = shouldLock
        ? new Date(now.getTime() + AuthService.LOCKOUT_DURATION_MS)
        : null;

      await this.userModel.findByIdAndUpdate(user._id, {
        $set: {
          failedLoginAttempts: nextAttempts,
          lockoutUntil,
        },
      });

      if (shouldLock) {
        throw new ForbiddenException(
          'Account is temporarily locked due to multiple failed login attempts. Please try again later.',
        );
      }

      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(`Account is ${user.status.toLowerCase()}`);
    }

    const updatedUser =
      (await this.userModel.findByIdAndUpdate(
        user._id,
        {
          $set: {
            failedLoginAttempts: 0,
            lockoutUntil: null,
            lastLoginAt: now,
          },
        },
        { returnDocument: 'after' },
      )) ?? user;

    const jti = randomUUID();
    const payload: JwtPayload = {
      sub: String(updatedUser._id),
      email: updatedUser.email,
      role: updatedUser.role,
      jti,
    };

    const accessToken = await this.jwtService.signAsync(payload);
    const expSeconds = extractJwtExpSeconds(
      this.jwtService.decode(accessToken),
    );
    const expiresInConfig = this.configService.get<string>(
      'jwt.expiresIn',
      '1d',
    );
    const expiresAt = expSeconds
      ? new Date(expSeconds * 1000)
      : new Date(now.getTime() + parseExpiresInToMs(expiresInConfig));

    await this.sessionModel.create({
      user: updatedUser._id,
      jti,
      expiresAt,
      ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
    });

    const cookieName = this.getCookieName();
    const maxAge = Math.max(0, expiresAt.getTime() - Date.now());

    const cookieOptions: CookieOptions = {
      ...this.getBaseCookieOptions(),
      maxAge,
      expires: expiresAt,
    };

    return {
      response: {
        message: 'Login successful',
        user: this.toSafeUser(updatedUser),
        mustChangePassword: Boolean(updatedUser.mustChangePassword),
      },
      accessToken,
      cookieName,
      cookieOptions,
    };
  }

  /**
   * Generates a short-lived passwordResetToken and passwordResetExpiresAt for
   * active accounts without leaking whether an account exists.
   */
  async forgotPassword(
    dto: ForgotPasswordDto,
  ): Promise<ForgotPasswordResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.userModel
      .findOne({ email })
      .select('email firstName status');

    if (user && user.status === AccountStatus.ACTIVE) {
      const passwordResetToken = randomBytes(32).toString('hex');
      const passwordResetExpiresAt = new Date(
        Date.now() + AuthService.PASSWORD_RESET_TTL_MS,
      );

      await this.userModel.findByIdAndUpdate(user._id, {
        $set: {
          passwordResetToken,
          passwordResetExpiresAt,
        },
      });

      await this.mailService.sendPasswordResetEmail({
        to: user.email,
        firstName: user.firstName,
        token: passwordResetToken,
        expiresInMinutes: AuthService.PASSWORD_RESET_TTL_MINUTES,
      });
    }

    return {
      message:
        'If an active account exists with that email, a password reset link has been sent.',
    };
  }

  /**
   * Revokes the caller's active UserSession by jti and returns cookie-clearing
   * options matching the auth cookie configuration.
   */
  async logout(user: AuthenticatedUser): Promise<LogoutResult> {
    await this.sessionModel.updateOne(
      { jti: user.jti, user: user.userId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );

    return {
      response: { message: 'Logged out successfully' },
      cookieName: this.getCookieName(),
      clearCookieOptions: this.getBaseCookieOptions(),
    };
  }

  private getCookieName(): string {
    return this.configService.get<string>('jwt.cookieName', 'access_token');
  }

  private getBaseCookieOptions(): CookieOptions {
    const cookieSecure = this.configService.get<boolean>(
      'jwt.cookieSecure',
      false,
    );
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure,
      path: '/',
    };
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
