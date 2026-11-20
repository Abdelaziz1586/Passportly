import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { AccountStatus, Role } from '../../common/enums';
import { MailService } from '../mail/mail.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { ModeratorAssignment } from '../users/schemas/moderator-assignment.schema';
import { User } from '../users/schemas/user.schema';
import { AuthService } from './auth.service';
import { UserSession } from './schemas/user-session.schema';

describe('AuthService (ACC-01 register, ACC-02 verify-email, ACC-04/05 login)', () => {
  let service: AuthService;

  const mockUserModel = {
    exists: jest.fn(),
    create: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };

  const mockSessionModel = {
    create: jest.fn(),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
  };

  const mockJwtService = {
    signAsync: jest.fn(),
    decode: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      const values: Record<string, unknown> = {
        'jwt.expiresIn': '1d',
        'jwt.cookieName': 'access_token',
        'jwt.cookieSecure': false,
      };
      return key in values ? values[key] : defaultValue;
    }),
  };

  const mockReferenceDataService = {
    isCurrencySupported: jest.fn(),
  };

  const mockMailService = {
    sendVerificationEmail: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
  };

  const mockAssignmentModel = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockMailService.sendVerificationEmail.mockResolvedValue(true);
    mockMailService.sendPasswordResetEmail.mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
        {
          provide: getModelToken(UserSession.name),
          useValue: mockSessionModel,
        },
        {
          provide: getModelToken(ModeratorAssignment.name),
          useValue: mockAssignmentModel,
        },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: ReferenceDataService,
          useValue: mockReferenceDataService,
        },
        {
          provide: MailService,
          useValue: mockMailService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('registers a new user with hashed password, verification token, REGISTERED_USER role, and safe profile response', async () => {
      mockUserModel.exists.mockResolvedValue(null);
      mockReferenceDataService.isCurrencySupported.mockResolvedValue(true);

      const now = new Date('2026-11-19T10:00:00.000Z');
      mockUserModel.create.mockImplementation((doc: Record<string, unknown>) =>
        Promise.resolve({
          _id: '507f1f77bcf86cd799439011',
          ...doc,
          passwordResetToken: 'secret-reset-token',
          createdAt: now,
          updatedAt: now,
        }),
      );

      const result = await service.register({
        email: '  Traveler@Example.COM ',
        password: 'StrongPassword123!',
        firstName: '  Abdelaziz ',
        lastName: ' Mohamed ',
        phone: ' +201001234567 ',
        nationality: ' eg ',
        preferredCurrency: 'eur',
      });

      expect(mockUserModel.exists).toHaveBeenCalledWith({
        email: 'traveler@example.com',
      });
      expect(mockReferenceDataService.isCurrencySupported).toHaveBeenCalledWith(
        'EUR',
      );

      const createCalls = mockUserModel.create.mock.calls as [
        [Record<string, unknown>],
      ];
      const createArg = createCalls[0][0];
      expect(createArg.email).toBe('traveler@example.com');
      expect(createArg.firstName).toBe('Abdelaziz');
      expect(createArg.lastName).toBe('Mohamed');
      expect(createArg.phone).toBe('+201001234567');
      expect(createArg.nationality).toBe('EG');
      expect(createArg.preferredCurrency).toBe('EUR');
      expect(createArg.role).toBe(Role.REGISTERED_USER);
      expect(createArg.status).toBe(AccountStatus.ACTIVE);
      expect(createArg.isEmailVerified).toBe(false);
      expect(typeof createArg.emailVerificationToken).toBe('string');
      expect(String(createArg.emailVerificationToken).length).toBe(64);
      expect(typeof createArg.passwordHash).toBe('string');
      expect(createArg.passwordHash).not.toBe('StrongPassword123!');
      await expect(
        bcrypt.compare('StrongPassword123!', String(createArg.passwordHash)),
      ).resolves.toBe(true);

      expect(mockMailService.sendVerificationEmail).toHaveBeenCalledWith({
        to: 'traveler@example.com',
        firstName: 'Abdelaziz',
        token: createArg.emailVerificationToken,
      });

      expect(result).toEqual({
        id: '507f1f77bcf86cd799439011',
        email: 'traveler@example.com',
        firstName: 'Abdelaziz',
        lastName: 'Mohamed',
        phone: '+201001234567',
        nationality: 'EG',
        preferredCurrency: 'EUR',
        role: Role.REGISTERED_USER,
        status: AccountStatus.ACTIVE,
        isEmailVerified: false,
        createdAt: now,
        updatedAt: now,
      });
      expect('passwordHash' in result).toBe(false);
      expect('emailVerificationToken' in result).toBe(false);
      expect('passwordResetToken' in result).toBe(false);
    });

    it('defaults preferredCurrency to USD when omitted', async () => {
      mockUserModel.exists.mockResolvedValue(null);
      mockUserModel.create.mockImplementation((doc: Record<string, unknown>) =>
        Promise.resolve({
          _id: '507f1f77bcf86cd799439012',
          ...doc,
        }),
      );

      const result = await service.register({
        email: 'default@example.com',
        password: 'StrongPassword123!',
        firstName: 'Jane',
        lastName: 'Doe',
      });

      expect(
        mockReferenceDataService.isCurrencySupported,
      ).not.toHaveBeenCalled();
      expect(result.preferredCurrency).toBe('USD');
      expect(result.role).toBe(Role.REGISTERED_USER);
    });

    it('throws ConflictException when email already exists', async () => {
      mockUserModel.exists.mockResolvedValue({ _id: 'existing-id' });

      await expect(
        service.register({
          email: 'existing@example.com',
          password: 'StrongPassword123!',
          firstName: 'Jane',
          lastName: 'Doe',
        }),
      ).rejects.toThrow(ConflictException);

      expect(mockUserModel.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException on MongoDB duplicate key race condition (code 11000)', async () => {
      mockUserModel.exists.mockResolvedValue(null);
      mockUserModel.create.mockRejectedValue({ code: 11000 });

      await expect(
        service.register({
          email: 'race@example.com',
          password: 'StrongPassword123!',
          firstName: 'Jane',
          lastName: 'Doe',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when preferredCurrency is unsupported', async () => {
      mockUserModel.exists.mockResolvedValue(null);
      mockReferenceDataService.isCurrencySupported.mockResolvedValue(false);

      await expect(
        service.register({
          email: 'currency@example.com',
          password: 'StrongPassword123!',
          firstName: 'Jane',
          lastName: 'Doe',
          preferredCurrency: 'ZZZ',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockUserModel.create).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmail', () => {
    it('verifies email, sets isEmailVerified = true, and clears emailVerificationToken', async () => {
      const selectMock = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        email: 'traveler@example.com',
        status: AccountStatus.ACTIVE,
        isEmailVerified: false,
      });
      mockUserModel.findOne.mockReturnValue({ select: selectMock });
      mockUserModel.findOneAndUpdate.mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        email: 'traveler@example.com',
        isEmailVerified: true,
      });

      const result = await service.verifyEmail({
        emailVerificationToken: 'valid-token-123',
      });

      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        emailVerificationToken: 'valid-token-123',
      });
      expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: '507f1f77bcf86cd799439011',
          emailVerificationToken: 'valid-token-123',
        },
        {
          $set: { isEmailVerified: true },
          $unset: { emailVerificationToken: 1 },
        },
        { returnDocument: 'after' },
      );
      expect(result).toEqual({
        message: 'Email address verified successfully',
        isEmailVerified: true,
        email: 'traveler@example.com',
      });
    });

    it('supports token alias query param', async () => {
      const selectMock = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        email: 'alias@example.com',
        status: AccountStatus.ACTIVE,
        isEmailVerified: false,
      });
      mockUserModel.findOne.mockReturnValue({ select: selectMock });
      mockUserModel.findOneAndUpdate.mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        email: 'alias@example.com',
        isEmailVerified: true,
      });

      const result = await service.verifyEmail({ token: 'alias-token' });
      expect(result.isEmailVerified).toBe(true);
      expect(result.email).toBe('alias@example.com');
    });

    it('throws BadRequestException when token is missing or blank', async () => {
      await expect(service.verifyEmail({})).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.verifyEmail({ emailVerificationToken: '   ' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockUserModel.findOne).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when token does not match any user', async () => {
      const selectMock = jest.fn().mockResolvedValue(null);
      mockUserModel.findOne.mockReturnValue({ select: selectMock });

      await expect(
        service.verifyEmail({ emailVerificationToken: 'unknown-token' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockUserModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when account is suspended or deactivated', async () => {
      const selectMock = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        email: 'suspended@example.com',
        status: AccountStatus.SUSPENDED,
        isEmailVerified: false,
      });
      mockUserModel.findOne.mockReturnValue({ select: selectMock });

      await expect(
        service.verifyEmail({ emailVerificationToken: 'valid-token' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockUserModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when concurrent verification already consumed the token', async () => {
      const selectMock = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        email: 'race@example.com',
        status: AccountStatus.ACTIVE,
        isEmailVerified: false,
      });
      mockUserModel.findOne.mockReturnValue({ select: selectMock });
      mockUserModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(
        service.verifyEmail({ emailVerificationToken: 'race-token' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('login', () => {
    it('authenticates valid user, resets failedLoginAttempts, creates UserSession, signs JWT, and returns httpOnly cookie config', async () => {
      const passwordHash = await bcrypt.hash('StrongPass123!', 4);
      const userDoc = {
        _id: '507f1f77bcf86cd799439011',
        email: 'traveler@example.com',
        passwordHash,
        firstName: 'Abdelaziz',
        lastName: 'Mohamed',
        preferredCurrency: 'USD',
        role: Role.REGISTERED_USER,
        status: AccountStatus.ACTIVE,
        isEmailVerified: true,
        failedLoginAttempts: 2,
        lockoutUntil: null,
        mustChangePassword: false,
      };
      const selectMock = jest.fn().mockResolvedValue(userDoc);
      mockUserModel.findOne.mockReturnValue({ select: selectMock });
      mockUserModel.findByIdAndUpdate.mockResolvedValue({
        ...userDoc,
        failedLoginAttempts: 0,
        lockoutUntil: null,
      });

      const expSeconds = Math.floor(Date.now() / 1000) + 86400;
      mockJwtService.signAsync.mockResolvedValue('signed.jwt.token');
      mockJwtService.decode.mockReturnValue({ exp: expSeconds });
      mockSessionModel.create.mockResolvedValue({ _id: 'session-id' });

      const result = await service.login(
        {
          email: '  Traveler@Example.COM ',
          password: 'StrongPass123!',
        },
        { userAgent: 'JestAgent', ipAddress: '127.0.0.1' },
      );

      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        email: 'traveler@example.com',
      });
      expect(selectMock).toHaveBeenCalledWith('+passwordHash');
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011',
        {
          $set: {
            failedLoginAttempts: 0,
            lockoutUntil: null,
            lastLoginAt: expect.any(Date) as Date,
          },
        },
        { returnDocument: 'after' },
      );

      const signCalls = mockJwtService.signAsync.mock.calls as [
        [Record<string, unknown>],
      ];
      const jwtPayload = signCalls[0][0];
      expect(jwtPayload.sub).toBe('507f1f77bcf86cd799439011');
      expect(jwtPayload.email).toBe('traveler@example.com');
      expect(jwtPayload.role).toBe(Role.REGISTERED_USER);
      expect(typeof jwtPayload.jti).toBe('string');

      expect(mockSessionModel.create).toHaveBeenCalledWith({
        user: '507f1f77bcf86cd799439011',
        jti: jwtPayload.jti,
        expiresAt: new Date(expSeconds * 1000),
        userAgent: 'JestAgent',
        ipAddress: '127.0.0.1',
      });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.cookieName).toBe('access_token');
      expect(result.cookieOptions.httpOnly).toBe(true);
      expect(result.cookieOptions.sameSite).toBe('lax');
      expect(result.cookieOptions.secure).toBe(false);
      expect(result.cookieOptions.path).toBe('/');
      expect(result.response.message).toBe('Login successful');
      expect(result.response.mustChangePassword).toBe(false);
      expect(result.response.user.email).toBe('traveler@example.com');
      expect('passwordHash' in result.response.user).toBe(false);
    });

    it('throws UnauthorizedException when user does not exist', async () => {
      const selectMock = jest.fn().mockResolvedValue(null);
      mockUserModel.findOne.mockReturnValue({ select: selectMock });

      await expect(
        service.login({
          email: 'nobody@example.com',
          password: 'StrongPass123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockSessionModel.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when account is actively locked out even if password matches', async () => {
      const passwordHash = await bcrypt.hash('StrongPass123!', 4);
      const futureLock = new Date(Date.now() + 10 * 60 * 1000);
      const selectMock = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        email: 'locked@example.com',
        passwordHash,
        status: AccountStatus.ACTIVE,
        failedLoginAttempts: 5,
        lockoutUntil: futureLock,
      });
      mockUserModel.findOne.mockReturnValue({ select: selectMock });

      await expect(
        service.login({
          email: 'locked@example.com',
          password: 'StrongPass123!',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockSessionModel.create).not.toHaveBeenCalled();
    });

    it('increments failedLoginAttempts on invalid password and locks on 5th failed attempt', async () => {
      const passwordHash = await bcrypt.hash('StrongPass123!', 4);
      const selectMock = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        email: 'user@example.com',
        passwordHash,
        status: AccountStatus.ACTIVE,
        failedLoginAttempts: 4,
        lockoutUntil: null,
      });
      mockUserModel.findOne.mockReturnValue({ select: selectMock });

      await expect(
        service.login({
          email: 'user@example.com',
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011',
        {
          $set: {
            failedLoginAttempts: 5,
            lockoutUntil: expect.any(Date) as Date,
          },
        },
      );
      expect(mockSessionModel.create).not.toHaveBeenCalled();
    });

    it('resets attempt count from 0 after expired lockout on invalid password', async () => {
      const passwordHash = await bcrypt.hash('StrongPass123!', 4);
      const expiredLock = new Date(Date.now() - 60 * 1000);
      const selectMock = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        email: 'user@example.com',
        passwordHash,
        status: AccountStatus.ACTIVE,
        failedLoginAttempts: 5,
        lockoutUntil: expiredLock,
      });
      mockUserModel.findOne.mockReturnValue({ select: selectMock });

      await expect(
        service.login({
          email: 'user@example.com',
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011',
        {
          $set: {
            failedLoginAttempts: 1,
            lockoutUntil: null,
          },
        },
      );
    });

    it('throws ForbiddenException when account status is SUSPENDED or DEACTIVATED', async () => {
      const passwordHash = await bcrypt.hash('StrongPass123!', 4);
      const selectMock = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        email: 'suspended@example.com',
        passwordHash,
        status: AccountStatus.SUSPENDED,
        failedLoginAttempts: 0,
        lockoutUntil: null,
      });
      mockUserModel.findOne.mockReturnValue({ select: selectMock });

      await expect(
        service.login({
          email: 'suspended@example.com',
          password: 'StrongPass123!',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockSessionModel.create).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    const authUser = {
      userId: '507f1f77bcf86cd799439011',
      email: 'traveler@example.com',
      role: Role.REGISTERED_USER,
      jti: 'current-jti-1',
    };

    it('verifies current password, updates passwordHash, clears mustChangePassword, and revokes other sessions by default', async () => {
      const oldHash = await bcrypt.hash('OldPass123!', 4);
      const selectMock = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        email: 'traveler@example.com',
        passwordHash: oldHash,
        status: AccountStatus.ACTIVE,
        mustChangePassword: true,
      });
      mockUserModel.findById.mockReturnValue({ select: selectMock });
      mockUserModel.findByIdAndUpdate.mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        mustChangePassword: false,
      });
      mockSessionModel.updateMany.mockResolvedValue({ modifiedCount: 2 });

      const result = await service.changePassword(authUser, {
        currentPassword: 'OldPass123!',
        newPassword: 'NewStrongPass456!',
      });

      expect(mockUserModel.findById).toHaveBeenCalledWith(authUser.userId);
      expect(selectMock).toHaveBeenCalledWith('+passwordHash');

      const updateCalls = mockUserModel.findByIdAndUpdate.mock.calls as [
        [
          string,
          { $set: { passwordHash: string; mustChangePassword: boolean } },
          { returnDocument: string },
        ],
      ];
      expect(updateCalls[0][1].$set.mustChangePassword).toBe(false);
      await expect(
        bcrypt.compare(
          'NewStrongPass456!',
          updateCalls[0][1].$set.passwordHash,
        ),
      ).resolves.toBe(true);

      expect(mockSessionModel.updateMany).toHaveBeenCalledWith(
        {
          user: '507f1f77bcf86cd799439011',
          jti: { $ne: 'current-jti-1' },
          revokedAt: null,
        },
        { $set: { revokedAt: expect.any(Date) as Date } },
      );
      expect(result).toEqual({
        message: 'Password changed successfully',
        mustChangePassword: false,
        revokedOtherSessionsCount: 2,
      });
    });

    it('preserves other active sessions when revokeOtherSessions is false', async () => {
      const oldHash = await bcrypt.hash('OldPass123!', 4);
      const selectMock = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        passwordHash: oldHash,
        status: AccountStatus.ACTIVE,
        mustChangePassword: true,
      });
      mockUserModel.findById.mockReturnValue({ select: selectMock });
      mockUserModel.findByIdAndUpdate.mockResolvedValue({});

      const result = await service.changePassword(authUser, {
        currentPassword: 'OldPass123!',
        newPassword: 'NewStrongPass456!',
        revokeOtherSessions: false,
      });

      expect(mockSessionModel.updateMany).not.toHaveBeenCalled();
      expect(result).toEqual({
        message: 'Password changed successfully',
        mustChangePassword: false,
        revokedOtherSessionsCount: 0,
      });
    });

    it('throws UnauthorizedException when current password does not match', async () => {
      const oldHash = await bcrypt.hash('OldPass123!', 4);
      const selectMock = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        passwordHash: oldHash,
        status: AccountStatus.ACTIVE,
      });
      mockUserModel.findById.mockReturnValue({ select: selectMock });

      await expect(
        service.changePassword(authUser, {
          currentPassword: 'WrongPassword!',
          newPassword: 'NewStrongPass456!',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when new password matches current password', async () => {
      const oldHash = await bcrypt.hash('SameStrongPass123!', 4);
      const selectMock = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        passwordHash: oldHash,
        status: AccountStatus.ACTIVE,
      });
      mockUserModel.findById.mockReturnValue({ select: selectMock });

      await expect(
        service.changePassword(authUser, {
          currentPassword: 'SameStrongPass123!',
          newPassword: 'SameStrongPass123!',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when user account is inactive', async () => {
      const oldHash = await bcrypt.hash('OldPass123!', 4);
      const selectMock = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        passwordHash: oldHash,
        status: AccountStatus.SUSPENDED,
      });
      mockUserModel.findById.mockReturnValue({ select: selectMock });

      await expect(
        service.changePassword(authUser, {
          currentPassword: 'OldPass123!',
          newPassword: 'NewStrongPass456!',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('resetPassword', () => {
    it('validates token and expiry, hashes new password, clears token/lockout flags, and revokes active sessions', async () => {
      const futureExpiry = new Date(Date.now() + 10 * 60 * 1000);
      const selectMock = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        status: AccountStatus.ACTIVE,
        passwordResetExpiresAt: futureExpiry,
      });
      mockUserModel.findOne.mockReturnValue({ select: selectMock });
      mockUserModel.findOneAndUpdate.mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
      });
      mockSessionModel.updateMany.mockResolvedValue({ modifiedCount: 2 });

      const result = await service.resetPassword({
        passwordResetToken: 'valid-reset-token',
        newPassword: 'NewStrongPassword123!',
      });

      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        passwordResetToken: 'valid-reset-token',
      });
      expect(selectMock).toHaveBeenCalledWith('+passwordResetExpiresAt status');
      expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledTimes(1);

      const updateCalls = mockUserModel.findOneAndUpdate.mock.calls as [
        [
          Record<string, unknown>,
          {
            $set: {
              passwordHash: string;
              mustChangePassword: boolean;
              failedLoginAttempts: number;
              lockoutUntil: null;
            };
            $unset: {
              passwordResetToken: number;
              passwordResetExpiresAt: number;
            };
          },
          { returnDocument: string },
        ],
      ];
      const [filterArg, updateArg, optionsArg] = updateCalls[0];
      expect(filterArg._id).toBe('507f1f77bcf86cd799439011');
      expect(filterArg.passwordResetToken).toBe('valid-reset-token');
      expect(updateArg.$set.mustChangePassword).toBe(false);
      expect(updateArg.$set.failedLoginAttempts).toBe(0);
      expect(updateArg.$set.lockoutUntil).toBeNull();
      expect(updateArg.$unset).toEqual({
        passwordResetToken: 1,
        passwordResetExpiresAt: 1,
      });
      expect(optionsArg).toEqual({ returnDocument: 'after' });
      await expect(
        bcrypt.compare('NewStrongPassword123!', updateArg.$set.passwordHash),
      ).resolves.toBe(true);

      expect(mockSessionModel.updateMany).toHaveBeenCalledWith(
        { user: '507f1f77bcf86cd799439011', revokedAt: null },
        { $set: { revokedAt: expect.any(Date) as Date } },
      );
      expect(result).toEqual({
        message:
          'Password reset successfully. Please log in with your new password.',
      });
    });

    it('supports token alias property', async () => {
      const selectMock = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        status: AccountStatus.ACTIVE,
        passwordResetExpiresAt: new Date(Date.now() + 60_000),
      });
      mockUserModel.findOne.mockReturnValue({ select: selectMock });
      mockUserModel.findOneAndUpdate.mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
      });
      mockSessionModel.updateMany.mockResolvedValue({ modifiedCount: 1 });

      const result = await service.resetPassword({
        token: 'alias-reset-token',
        newPassword: 'NewStrongPassword123!',
      });

      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        passwordResetToken: 'alias-reset-token',
      });
      expect(result.message).toContain('Password reset successfully');
    });

    it('throws BadRequestException when reset token is missing or expired or unknown', async () => {
      await expect(
        service.resetPassword({ newPassword: 'NewStrongPassword123!' }),
      ).rejects.toThrow(BadRequestException);

      const unknownSelect = jest.fn().mockResolvedValue(null);
      mockUserModel.findOne.mockReturnValue({ select: unknownSelect });
      await expect(
        service.resetPassword({
          passwordResetToken: 'unknown',
          newPassword: 'NewStrongPassword123!',
        }),
      ).rejects.toThrow(BadRequestException);

      const expiredSelect = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        status: AccountStatus.ACTIVE,
        passwordResetExpiresAt: new Date(Date.now() - 1000),
      });
      mockUserModel.findOne.mockReturnValue({ select: expiredSelect });
      await expect(
        service.resetPassword({
          passwordResetToken: 'expired',
          newPassword: 'NewStrongPassword123!',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockSessionModel.updateMany).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when account is inactive or token was concurrently consumed', async () => {
      const inactiveSelect = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        status: AccountStatus.SUSPENDED,
        passwordResetExpiresAt: new Date(Date.now() + 60_000),
      });
      mockUserModel.findOne.mockReturnValue({ select: inactiveSelect });
      await expect(
        service.resetPassword({
          passwordResetToken: 'valid',
          newPassword: 'NewStrongPassword123!',
        }),
      ).rejects.toThrow(BadRequestException);

      const activeSelect = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        status: AccountStatus.ACTIVE,
        passwordResetExpiresAt: new Date(Date.now() + 60_000),
      });
      mockUserModel.findOne.mockReturnValue({ select: activeSelect });
      mockUserModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(
        service.resetPassword({
          passwordResetToken: 'race-token',
          newPassword: 'NewStrongPassword123!',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockSessionModel.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('generates short-lived passwordResetToken and passwordResetExpiresAt for active user and sends reset email', async () => {
      const selectMock = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        email: 'traveler@example.com',
        firstName: 'Abdelaziz',
        status: AccountStatus.ACTIVE,
      });
      mockUserModel.findOne.mockReturnValue({ select: selectMock });
      mockUserModel.findByIdAndUpdate.mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
      });

      const before = Date.now();
      const result = await service.forgotPassword({
        email: '  Traveler@Example.COM ',
      });
      const after = Date.now();

      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        email: 'traveler@example.com',
      });
      expect(selectMock).toHaveBeenCalledWith('email firstName status');
      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledTimes(1);

      const updateCalls = mockUserModel.findByIdAndUpdate.mock.calls as [
        [
          string,
          {
            $set: {
              passwordResetToken: string;
              passwordResetExpiresAt: Date;
            };
          },
        ],
      ];
      const token = updateCalls[0][1].$set.passwordResetToken;
      const expiresAt = updateCalls[0][1].$set.passwordResetExpiresAt;

      expect(typeof token).toBe('string');
      expect(token).toHaveLength(64);
      expect(expiresAt).toBeInstanceOf(Date);
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + 14 * 60 * 1000,
      );
      expect(expiresAt.getTime()).toBeLessThanOrEqual(after + 16 * 60 * 1000);

      expect(mockMailService.sendPasswordResetEmail).toHaveBeenCalledWith({
        to: 'traveler@example.com',
        firstName: 'Abdelaziz',
        token,
        expiresInMinutes: 15,
      });
      expect(result).toEqual({
        message:
          'If an active account exists with that email, a password reset link has been sent.',
      });
    });

    it('returns identical generic response without updating or sending email when account does not exist', async () => {
      const selectMock = jest.fn().mockResolvedValue(null);
      mockUserModel.findOne.mockReturnValue({ select: selectMock });

      const result = await service.forgotPassword({
        email: 'unknown@example.com',
      });

      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(mockMailService.sendPasswordResetEmail).not.toHaveBeenCalled();
      expect(result).toEqual({
        message:
          'If an active account exists with that email, a password reset link has been sent.',
      });
    });

    it('returns identical generic response without generating token for suspended or deactivated accounts', async () => {
      const selectMock = jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        email: 'suspended@example.com',
        firstName: 'Suspended',
        status: AccountStatus.SUSPENDED,
      });
      mockUserModel.findOne.mockReturnValue({ select: selectMock });

      const result = await service.forgotPassword({
        email: 'suspended@example.com',
      });

      expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(mockMailService.sendPasswordResetEmail).not.toHaveBeenCalled();
      expect(result).toEqual({
        message:
          'If an active account exists with that email, a password reset link has been sent.',
      });
    });
  });

  describe('logout', () => {
    it('revokes current UserSession by jti and returns clearCookie options', async () => {
      mockSessionModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await service.logout({
        userId: '507f1f77bcf86cd799439011',
        email: 'traveler@example.com',
        role: Role.REGISTERED_USER,
        jti: 'session-jti-123',
      });

      expect(mockSessionModel.updateOne).toHaveBeenCalledWith(
        {
          jti: 'session-jti-123',
          user: '507f1f77bcf86cd799439011',
          revokedAt: null,
        },
        { $set: { revokedAt: expect.any(Date) as Date } },
      );
      expect(result).toEqual({
        response: { message: 'Logged out successfully' },
        cookieName: 'access_token',
        clearCookieOptions: {
          httpOnly: true,
          sameSite: 'lax',
          secure: false,
          path: '/',
        },
      });
    });
  });
  describe('getMe', () => {
    it('returns safe user details, role, status, and omits sensitive fields for traveler', async () => {
      const lastLoginAt = new Date('2026-11-19T12:00:00.000Z');
      mockUserModel.findById.mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        email: 'traveler@example.com',
        firstName: 'Abdelaziz',
        lastName: 'Mohamed',
        preferredCurrency: 'EGP',
        role: Role.REGISTERED_USER,
        status: AccountStatus.ACTIVE,
        isEmailVerified: true,
        mustChangePassword: false,
        lastLoginAt,
        passwordHash: 'secret-hash',
        emailVerificationToken: 'secret-verify',
        passwordResetToken: 'secret-reset',
      });

      const result = await service.getMe({
        userId: '507f1f77bcf86cd799439011',
        email: 'traveler@example.com',
        role: Role.REGISTERED_USER,
        jti: 'jti-1',
      });

      expect(result).toEqual({
        id: '507f1f77bcf86cd799439011',
        email: 'traveler@example.com',
        firstName: 'Abdelaziz',
        lastName: 'Mohamed',
        preferredCurrency: 'EGP',
        role: Role.REGISTERED_USER,
        status: AccountStatus.ACTIVE,
        isEmailVerified: true,
        mustChangePassword: false,
        lastLoginAt,
      });
      expect('passwordHash' in result).toBe(false);
      expect('emailVerificationToken' in result).toBe(false);
      expect('passwordResetToken' in result).toBe(false);
      expect(result.assignedProviderId).toBeUndefined();
    });

    it('includes assignedProviderId and assignedProviderType for moderators', async () => {
      mockUserModel.findById.mockResolvedValue({
        _id: '507f1f77bcf86cd799439022',
        email: 'airline-mod@example.com',
        firstName: 'Airline',
        lastName: 'Mod',
        preferredCurrency: 'USD',
        role: Role.AIRLINE_MODERATOR,
        status: AccountStatus.ACTIVE,
        isEmailVerified: true,
        mustChangePassword: true,
      });

      const result = await service.getMe({
        userId: '507f1f77bcf86cd799439022',
        email: 'airline-mod@example.com',
        role: Role.AIRLINE_MODERATOR,
        jti: 'jti-mod',
        assignedProviderId: '507f1f77bcf86cd799439099',
        assignedProviderType: 'airline',
      });

      expect(result.assignedProviderId).toBe('507f1f77bcf86cd799439099');
      expect(result.assignedProviderType).toBe('airline');
      expect(result.mustChangePassword).toBe(true);
    });

    it('falls back to ModeratorAssignment lookup when moderator context is absent from authUser', async () => {
      mockUserModel.findById.mockResolvedValue({
        _id: '507f1f77bcf86cd799439033',
        email: 'hotel-mod@example.com',
        firstName: 'Hotel',
        lastName: 'Mod',
        preferredCurrency: 'USD',
        role: Role.HOTEL_MODERATOR,
        status: AccountStatus.ACTIVE,
        isEmailVerified: true,
        mustChangePassword: false,
      });
      mockAssignmentModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          providerType: 'hotel',
          hotel: '507f1f77bcf86cd799439088',
        }),
      });

      const result = await service.getMe({
        userId: '507f1f77bcf86cd799439033',
        email: 'hotel-mod@example.com',
        role: Role.HOTEL_MODERATOR,
        jti: 'jti-hotel-mod',
      });

      expect(result.assignedProviderId).toBe('507f1f77bcf86cd799439088');
      expect(result.assignedProviderType).toBe('hotel');
    });

    it('throws UnauthorizedException or ForbiddenException when user is missing or inactive', async () => {
      await expect(
        service.getMe({
          userId: 'invalid-id',
          email: 'bad@example.com',
          role: Role.REGISTERED_USER,
          jti: 'jti',
        }),
      ).rejects.toThrow(UnauthorizedException);

      mockUserModel.findById.mockResolvedValue(null);
      await expect(
        service.getMe({
          userId: '507f1f77bcf86cd799439011',
          email: 'missing@example.com',
          role: Role.REGISTERED_USER,
          jti: 'jti',
        }),
      ).rejects.toThrow(UnauthorizedException);

      mockUserModel.findById.mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        status: AccountStatus.SUSPENDED,
      });
      await expect(
        service.getMe({
          userId: '507f1f77bcf86cd799439011',
          email: 'suspended@example.com',
          role: Role.REGISTERED_USER,
          jti: 'jti',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('revokeUserSessions', () => {
    it('revokes all unrevoked sessions for a user and returns modified count', async () => {
      mockSessionModel.updateMany.mockResolvedValue({ modifiedCount: 2 });

      const count = await service.revokeUserSessions(
        '507f1f77bcf86cd799439011',
      );

      expect(count).toBe(2);
      expect(mockSessionModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: null }) as unknown,
        expect.objectContaining({
          $set: expect.objectContaining({
            revokedAt: expect.any(Date) as unknown,
          }) as unknown,
        }),
      );
    });
  });
});
