import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import type { Request, Response } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AccountStatus, ProviderType, Role } from '../../common/enums';
import { AllExceptionsFilter } from '../../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { MailService } from '../mail/mail.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { ModeratorAssignment } from '../users/schemas/moderator-assignment.schema';
import { User } from '../users/schemas/user.schema';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailQueryDto } from './dto/verify-email-query.dto';
import { UserSession } from './schemas/user-session.schema';
import { JwtStrategy } from './strategies/jwt.strategy';

describe('AuthController (ACC-01 register, ACC-02 verify-email, ACC-04/05 login, ACC-06 logout, ACC-07 forgot-password, ACC-07 reset-password, ACC-08 change-password, ACC-04/19 me)', () => {
  let controller: AuthController;
  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  });

  const mockAuthService = {
    register: jest.fn(),
    verifyEmail: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    changePassword: jest.fn(),
    getMe: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('register', () => {
    it('marks register endpoint as @Public()', () => {
      const reflector = new Reflector();
      const registerHandler = Object.getOwnPropertyDescriptor(
        AuthController.prototype,
        'register',
      )?.value as (...args: never[]) => unknown;
      const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, registerHandler);
      expect(isPublic).toBe(true);
    });

    it('delegates valid registration payload to AuthService.register', async () => {
      const expected = {
        id: '507f1f77bcf86cd799439011',
        email: 'traveler@example.com',
        firstName: 'Abdelaziz',
        lastName: 'Mohamed',
        preferredCurrency: 'USD',
        role: Role.REGISTERED_USER,
        status: AccountStatus.ACTIVE,
        isEmailVerified: false,
      };
      mockAuthService.register.mockResolvedValue(expected);

      const dto = (await validationPipe.transform(
        {
          email: '  Traveler@Example.com ',
          password: 'StrongPassword123!',
          firstName: 'Abdelaziz',
          lastName: 'Mohamed',
        },
        { type: 'body', metatype: RegisterDto },
      )) as RegisterDto;

      const result = await controller.register(dto);
      expect(result).toEqual(expected);
      expect(mockAuthService.register).toHaveBeenCalledWith(dto);
    });

    it('rejects weak passwords via ValidationPipe', async () => {
      await expect(
        validationPipe.transform(
          {
            email: 'traveler@example.com',
            password: 'weak',
            firstName: 'Abdelaziz',
            lastName: 'Mohamed',
          },
          { type: 'body', metatype: RegisterDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects role injection (e.g., ADMIN) via forbidNonWhitelisted', async () => {
      await expect(
        validationPipe.transform(
          {
            email: 'attacker@example.com',
            password: 'StrongPassword123!',
            firstName: 'Bad',
            lastName: 'Actor',
            role: 'ADMIN',
          },
          { type: 'body', metatype: RegisterDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects whitespace-only firstName or lastName', async () => {
      await expect(
        validationPipe.transform(
          {
            email: 'traveler@example.com',
            password: 'StrongPassword123!',
            firstName: '   ',
            lastName: 'Mohamed',
          },
          { type: 'body', metatype: RegisterDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyEmail', () => {
    it('marks verifyEmail endpoint as @Public()', () => {
      const reflector = new Reflector();
      const verifyEmailHandler = Object.getOwnPropertyDescriptor(
        AuthController.prototype,
        'verifyEmail',
      )?.value as (...args: never[]) => unknown;
      const isPublic = reflector.get<boolean>(
        IS_PUBLIC_KEY,
        verifyEmailHandler,
      );
      expect(isPublic).toBe(true);
    });

    it('delegates valid emailVerificationToken query to AuthService.verifyEmail', async () => {
      const expected = {
        message: 'Email address verified successfully',
        isEmailVerified: true,
        email: 'traveler@example.com',
      };
      mockAuthService.verifyEmail.mockResolvedValue(expected);

      const query = (await validationPipe.transform(
        { emailVerificationToken: '  abc123token  ' },
        { type: 'query', metatype: VerifyEmailQueryDto },
      )) as VerifyEmailQueryDto;

      const result = await controller.verifyEmail(query);
      expect(query.emailVerificationToken).toBe('abc123token');
      expect(result).toEqual(expected);
      expect(mockAuthService.verifyEmail).toHaveBeenCalledWith(query);
    });

    it('rejects unknown query parameters via forbidNonWhitelisted', async () => {
      await expect(
        validationPipe.transform(
          { emailVerificationToken: 'abc123', extra: 'nope' },
          { type: 'query', metatype: VerifyEmailQueryDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('login', () => {
    it('marks login endpoint as @Public()', () => {
      const reflector = new Reflector();
      const loginHandler = Object.getOwnPropertyDescriptor(
        AuthController.prototype,
        'login',
      )?.value as (...args: never[]) => unknown;
      const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, loginHandler);
      expect(isPublic).toBe(true);
    });

    it('sets httpOnly cookie and returns login response', async () => {
      const expectedResponse = {
        message: 'Login successful',
        mustChangePassword: false,
        user: {
          id: '507f1f77bcf86cd799439011',
          email: 'traveler@example.com',
          firstName: 'Abdelaziz',
          lastName: 'Mohamed',
          preferredCurrency: 'USD',
          role: Role.REGISTERED_USER,
          status: AccountStatus.ACTIVE,
          isEmailVerified: true,
        },
      };
      const cookieOptions = {
        httpOnly: true,
        sameSite: 'lax' as const,
        secure: false,
        path: '/',
        maxAge: 86400000,
      };
      mockAuthService.login.mockResolvedValue({
        response: expectedResponse,
        accessToken: 'jwt-token',
        cookieName: 'access_token',
        cookieOptions,
      });

      const dto = (await validationPipe.transform(
        {
          email: '  Traveler@Example.com ',
          password: 'StrongPassword123!',
        },
        { type: 'body', metatype: LoginDto },
      )) as LoginDto;

      const req = {
        get: jest.fn().mockReturnValue('Mozilla/5.0'),
        ip: '127.0.0.1',
      } as unknown as Request;
      const cookieMock = jest.fn();
      const res = {
        cookie: cookieMock,
      } as unknown as Response;

      const result = await controller.login(dto, req, res);

      expect(mockAuthService.login).toHaveBeenCalledWith(dto, {
        userAgent: 'Mozilla/5.0',
        ipAddress: '127.0.0.1',
      });
      expect(cookieMock).toHaveBeenCalledWith(
        'access_token',
        'jwt-token',
        cookieOptions,
      );
      expect(result).toEqual(expectedResponse);
    });

    it('rejects non-whitelisted properties on login payload', async () => {
      await expect(
        validationPipe.transform(
          {
            email: 'traveler@example.com',
            password: 'StrongPassword123!',
            role: 'ADMIN',
          },
          { type: 'body', metatype: LoginDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resetPassword', () => {
    it('marks resetPassword endpoint as @Public()', () => {
      const reflector = new Reflector();
      const handler = Object.getOwnPropertyDescriptor(
        AuthController.prototype,
        'resetPassword',
      )?.value as (...args: never[]) => unknown;
      const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, handler);
      expect(isPublic).toBe(true);
    });

    it('delegates valid ResetPasswordDto to AuthService.resetPassword', async () => {
      const expected = {
        message:
          'Password reset successfully. Please log in with your new password.',
      };
      mockAuthService.resetPassword.mockResolvedValue(expected);

      const dto = (await validationPipe.transform(
        {
          passwordResetToken: '  reset-token-123  ',
          newPassword: 'NewStrongPassword123!',
        },
        { type: 'body', metatype: ResetPasswordDto },
      )) as ResetPasswordDto;

      const result = await controller.resetPassword(dto);
      expect(dto.passwordResetToken).toBe('reset-token-123');
      expect(mockAuthService.resetPassword).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expected);
    });

    it('rejects weak newPassword and non-whitelisted fields on ResetPasswordDto', async () => {
      await expect(
        validationPipe.transform(
          { passwordResetToken: 'tok', newPassword: 'weak' },
          { type: 'body', metatype: ResetPasswordDto },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        validationPipe.transform(
          {
            passwordResetToken: 'tok',
            newPassword: 'NewStrongPassword123!',
            role: 'ADMIN',
          },
          { type: 'body', metatype: ResetPasswordDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('HTTP integration (ACC-07 reset-password)', () => {
    it('resets password once, invalidates existing JWT sessions, and rejects token reuse or expired tokens', async () => {
      const userId = '507f1f77bcf86cd799439011';
      const jti = 'active-session-jti';
      const userState: {
        _id: string;
        email: string;
        role: Role;
        status: AccountStatus;
        passwordHash: string;
        passwordResetToken?: string;
        passwordResetExpiresAt?: Date;
        mustChangePassword: boolean;
        failedLoginAttempts: number;
        lockoutUntil: Date | null;
      } = {
        _id: userId,
        email: 'traveler@example.com',
        role: Role.REGISTERED_USER,
        status: AccountStatus.ACTIVE,
        passwordHash: 'old-hash',
        passwordResetToken: 'single-use-reset-token',
        passwordResetExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        mustChangePassword: true,
        failedLoginAttempts: 3,
        lockoutUntil: new Date(Date.now() + 60_000),
      };
      let sessionRevokedAt: Date | null = null;

      const fakeUserModel = {
        findById: jest.fn(() =>
          Object.assign(Promise.resolve(userState), {
            lean: jest.fn().mockResolvedValue(userState),
          }),
        ),
        findOne: jest.fn((filter: { passwordResetToken?: string }) => ({
          select: jest.fn().mockImplementation(() => {
            if (filter.passwordResetToken === userState.passwordResetToken) {
              return Promise.resolve(userState);
            }
            return Promise.resolve(null);
          }),
        })),
        findOneAndUpdate: jest.fn(
          (
            filter: {
              _id: string;
              passwordResetToken: string;
              passwordResetExpiresAt: { $gt: Date };
            },
            update: {
              $set: {
                passwordHash: string;
                mustChangePassword: boolean;
                failedLoginAttempts: number;
                lockoutUntil: null;
              };
            },
          ) => {
            if (
              filter._id === userState._id &&
              filter.passwordResetToken === userState.passwordResetToken &&
              userState.passwordResetExpiresAt &&
              userState.passwordResetExpiresAt >
                filter.passwordResetExpiresAt.$gt
            ) {
              userState.passwordHash = update.$set.passwordHash;
              userState.mustChangePassword = update.$set.mustChangePassword;
              userState.failedLoginAttempts = update.$set.failedLoginAttempts;
              userState.lockoutUntil = update.$set.lockoutUntil;
              delete userState.passwordResetToken;
              delete userState.passwordResetExpiresAt;
              return Promise.resolve(userState);
            }
            return Promise.resolve(null);
          },
        ),
      };

      const fakeSessionModel = {
        findOne: jest.fn((filter: { jti?: string; user?: string }) => ({
          lean: jest.fn().mockImplementation(() => {
            if (filter.jti === jti && filter.user === userId) {
              return Promise.resolve({
                _id: 'session-1',
                user: userId,
                jti,
                expiresAt: new Date(Date.now() + 3600_000),
                revokedAt: sessionRevokedAt,
              });
            }
            return Promise.resolve(null);
          }),
        })),
        updateMany: jest.fn(
          (
            filter: { user?: string; revokedAt?: null },
            update: { $set?: { revokedAt?: Date } },
          ) => {
            if (filter.user === userId && sessionRevokedAt === null) {
              sessionRevokedAt = update.$set?.revokedAt ?? new Date();
              return Promise.resolve({ modifiedCount: 1 });
            }
            return Promise.resolve({ modifiedCount: 0 });
          },
        ),
      };

      const configValues: Record<string, unknown> = {
        'jwt.secret': 'test-jwt-secret',
        'jwt.expiresIn': '1d',
        'jwt.cookieName': 'access_token',
        'jwt.cookieSecure': false,
      };
      const fakeConfigService = {
        get: jest.fn((key: string, defaultValue?: unknown) =>
          key in configValues ? configValues[key] : defaultValue,
        ),
      };

      const moduleRef = await Test.createTestingModule({
        imports: [
          PassportModule.register({ defaultStrategy: 'jwt' }),
          JwtModule.register({
            secret: 'test-jwt-secret',
            signOptions: { expiresIn: '1d' },
          }),
        ],
        controllers: [AuthController],
        providers: [
          AuthService,
          JwtStrategy,
          { provide: ConfigService, useValue: fakeConfigService },
          { provide: getModelToken(User.name), useValue: fakeUserModel },
          {
            provide: getModelToken(UserSession.name),
            useValue: fakeSessionModel,
          },
          {
            provide: getModelToken(ModeratorAssignment.name),
            useValue: { findOne: jest.fn() },
          },
          {
            provide: ReferenceDataService,
            useValue: { isCurrencySupported: jest.fn() },
          },
          {
            provide: MailService,
            useValue: { sendVerificationEmail: jest.fn() },
          },
          { provide: APP_GUARD, useClass: JwtAuthGuard },
          { provide: APP_GUARD, useClass: RolesGuard },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      app.use(cookieParser());
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
      );
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      try {
        const jwtService = moduleRef.get(JwtService);
        const oldCookie = await jwtService.signAsync({
          sub: userId,
          email: userState.email,
          role: userState.role,
          jti,
        });

        await request(app.getHttpServer() as App)
          .get('/api/auth/me')
          .set('Cookie', [`access_token=${oldCookie}`])
          .expect(200);

        const resetRes = await request(app.getHttpServer() as App)
          .post('/api/auth/reset-password')
          .send({
            passwordResetToken: 'single-use-reset-token',
            newPassword: 'NewStrongPassword123!',
          })
          .expect(200);

        expect(resetRes.body).toEqual({
          message:
            'Password reset successfully. Please log in with your new password.',
        });
        expect(userState.mustChangePassword).toBe(false);
        expect(userState.passwordResetToken).toBeUndefined();
        expect(sessionRevokedAt).toBeInstanceOf(Date);

        // Old session cookie must now be rejected
        await request(app.getHttpServer() as App)
          .get('/api/auth/me')
          .set('Cookie', [`access_token=${oldCookie}`])
          .expect(401);

        // Reusing same token fails
        await request(app.getHttpServer() as App)
          .post('/api/auth/reset-password')
          .send({
            passwordResetToken: 'single-use-reset-token',
            newPassword: 'AnotherStrongPassword123!',
          })
          .expect(400);
      } finally {
        await app.close();
      }
    });
  });

  describe('forgotPassword', () => {
    it('marks forgotPassword endpoint as @Public()', () => {
      const reflector = new Reflector();
      const handler = Object.getOwnPropertyDescriptor(
        AuthController.prototype,
        'forgotPassword',
      )?.value as (...args: never[]) => unknown;
      const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, handler);
      expect(isPublic).toBe(true);
    });

    it('delegates normalized ForgotPasswordDto to AuthService.forgotPassword', async () => {
      const expected = {
        message:
          'If an active account exists with that email, a password reset link has been sent.',
      };
      mockAuthService.forgotPassword.mockResolvedValue(expected);

      const dto = (await validationPipe.transform(
        { email: '  Traveler@Example.com ' },
        { type: 'body', metatype: ForgotPasswordDto },
      )) as ForgotPasswordDto;

      const result = await controller.forgotPassword(dto);
      expect(dto.email).toBe('traveler@example.com');
      expect(mockAuthService.forgotPassword).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expected);
    });

    it('rejects invalid email and unknown properties on ForgotPasswordDto', async () => {
      await expect(
        validationPipe.transform(
          { email: 'not-an-email' },
          { type: 'body', metatype: ForgotPasswordDto },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        validationPipe.transform(
          { email: 'traveler@example.com', role: 'ADMIN' },
          { type: 'body', metatype: ForgotPasswordDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('HTTP integration (ACC-07 forgot-password)', () => {
    it('returns identical 200 response for active, unknown, and suspended accounts without leaking tokens or existence', async () => {
      const fakeUsers = new Map<
        string,
        {
          _id: string;
          email: string;
          firstName: string;
          status: AccountStatus;
          passwordResetToken?: string;
          passwordResetExpiresAt?: Date;
        }
      >([
        [
          'active@example.com',
          {
            _id: '507f1f77bcf86cd799439011',
            email: 'active@example.com',
            firstName: 'Active',
            status: AccountStatus.ACTIVE,
          },
        ],
        [
          'suspended@example.com',
          {
            _id: '507f1f77bcf86cd799439012',
            email: 'suspended@example.com',
            firstName: 'Suspended',
            status: AccountStatus.SUSPENDED,
          },
        ],
      ]);

      const fakeUserModel = {
        findOne: jest.fn(({ email }: { email: string }) => ({
          select: jest.fn().mockResolvedValue(fakeUsers.get(email) ?? null),
        })),
        findByIdAndUpdate: jest.fn(
          (
            id: string,
            update: {
              $set: {
                passwordResetToken: string;
                passwordResetExpiresAt: Date;
              };
            },
          ) => {
            for (const user of fakeUsers.values()) {
              if (user._id === id) {
                user.passwordResetToken = update.$set.passwordResetToken;
                user.passwordResetExpiresAt =
                  update.$set.passwordResetExpiresAt;
              }
            }
            return Promise.resolve({ _id: id });
          },
        ),
      };

      const sendPasswordResetEmail = jest.fn().mockResolvedValue(true);

      const moduleRef = await Test.createTestingModule({
        controllers: [AuthController],
        providers: [
          AuthService,
          { provide: getModelToken(User.name), useValue: fakeUserModel },
          { provide: getModelToken(UserSession.name), useValue: {} },
          { provide: JwtService, useValue: {} },
          {
            provide: ConfigService,
            useValue: { get: jest.fn((_k: string, d?: unknown) => d) },
          },
          {
            provide: ReferenceDataService,
            useValue: { isCurrencySupported: jest.fn() },
          },
          {
            provide: MailService,
            useValue: {
              sendVerificationEmail: jest.fn(),
              sendPasswordResetEmail,
            },
          },
          { provide: APP_GUARD, useClass: JwtAuthGuard },
          { provide: APP_GUARD, useClass: RolesGuard },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
      );
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      try {
        const resActive = await request(app.getHttpServer() as App)
          .post('/api/auth/forgot-password')
          .send({ email: 'ACTIVE@Example.com' })
          .expect(200);
        const resUnknown = await request(app.getHttpServer() as App)
          .post('/api/auth/forgot-password')
          .send({ email: 'missing@example.com' })
          .expect(200);
        const resSuspended = await request(app.getHttpServer() as App)
          .post('/api/auth/forgot-password')
          .send({ email: 'suspended@example.com' })
          .expect(200);

        expect(resActive.body).toEqual(resUnknown.body);
        expect(resActive.body).toEqual(resSuspended.body);
        expect(
          fakeUsers.get('active@example.com')?.passwordResetToken,
        ).toHaveLength(64);
        expect(
          fakeUsers.get('suspended@example.com')?.passwordResetToken,
        ).toBeUndefined();
        expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);

        await request(app.getHttpServer() as App)
          .post('/api/auth/forgot-password')
          .send({ email: 'bad-email' })
          .expect(400);
      } finally {
        await app.close();
      }
    });
  });

  describe('logout', () => {
    it('does not mark logout endpoint as @Public() (requires authentication)', () => {
      const reflector = new Reflector();
      const logoutHandler = Object.getOwnPropertyDescriptor(
        AuthController.prototype,
        'logout',
      )?.value as (...args: never[]) => unknown;
      const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, logoutHandler);
      expect(isPublic).toBeUndefined();
    });

    it('revokes session and clears httpOnly auth cookie', async () => {
      const clearCookieOptions = {
        httpOnly: true,
        sameSite: 'lax' as const,
        secure: false,
        path: '/',
      };
      mockAuthService.logout.mockResolvedValue({
        response: { message: 'Logged out successfully' },
        cookieName: 'access_token',
        clearCookieOptions,
      });

      const clearCookieMock = jest.fn();
      const res = {
        clearCookie: clearCookieMock,
      } as unknown as Response;

      const user = {
        userId: '507f1f77bcf86cd799439011',
        email: 'traveler@example.com',
        role: Role.REGISTERED_USER,
        jti: 'session-jti-123',
      };

      const result = await controller.logout(user, res);

      expect(mockAuthService.logout).toHaveBeenCalledWith(user);
      expect(clearCookieMock).toHaveBeenCalledWith(
        'access_token',
        clearCookieOptions,
      );
      expect(result).toEqual({ message: 'Logged out successfully' });
    });
  });

  describe('HTTP integration (ACC-06 logout)', () => {
    it('rejects unauthenticated logout, revokes session and clears cookie on valid logout, and blocks subsequent reuse of the revoked cookie', async () => {
      const userId = '507f1f77bcf86cd799439011';
      const jti = 'logout-http-jti-1';
      let sessionRevokedAt: Date | null = null;

      const fakeUser = {
        _id: userId,
        email: 'traveler@example.com',
        role: Role.REGISTERED_USER,
        status: AccountStatus.ACTIVE,
      };

      const fakeUserModel = {
        findById: jest.fn(() => ({
          lean: jest.fn().mockResolvedValue(fakeUser),
        })),
      };

      const fakeSessionModel = {
        findOne: jest.fn((filter: { jti?: string; user?: string }) => ({
          lean: jest.fn().mockImplementation(() => {
            if (filter.jti === jti && filter.user === userId) {
              return Promise.resolve({
                _id: 'session-1',
                user: userId,
                jti,
                expiresAt: new Date(Date.now() + 3600_000),
                revokedAt: sessionRevokedAt,
              });
            }
            return Promise.resolve(null);
          }),
        })),
        updateOne: jest.fn(
          (
            filter: { jti?: string; user?: string; revokedAt?: null },
            update: { $set?: { revokedAt?: Date } },
          ) => {
            if (
              filter.jti === jti &&
              filter.user === userId &&
              sessionRevokedAt === null
            ) {
              sessionRevokedAt = update.$set?.revokedAt ?? new Date();
              return Promise.resolve({ modifiedCount: 1 });
            }
            return Promise.resolve({ modifiedCount: 0 });
          },
        ),
      };

      const configValues: Record<string, unknown> = {
        'jwt.secret': 'test-jwt-secret',
        'jwt.expiresIn': '1d',
        'jwt.cookieName': 'access_token',
        'jwt.cookieSecure': false,
      };
      const fakeConfigService = {
        get: jest.fn((key: string, defaultValue?: unknown) =>
          key in configValues ? configValues[key] : defaultValue,
        ),
      };

      const moduleRef = await Test.createTestingModule({
        imports: [
          PassportModule.register({ defaultStrategy: 'jwt' }),
          JwtModule.register({
            secret: 'test-jwt-secret',
            signOptions: { expiresIn: '1d' },
          }),
        ],
        controllers: [AuthController],
        providers: [
          AuthService,
          JwtStrategy,
          { provide: ConfigService, useValue: fakeConfigService },
          { provide: getModelToken(User.name), useValue: fakeUserModel },
          {
            provide: getModelToken(UserSession.name),
            useValue: fakeSessionModel,
          },
          {
            provide: getModelToken(ModeratorAssignment.name),
            useValue: { findOne: jest.fn() },
          },
          {
            provide: ReferenceDataService,
            useValue: { isCurrencySupported: jest.fn() },
          },
          {
            provide: MailService,
            useValue: { sendVerificationEmail: jest.fn() },
          },
          { provide: APP_GUARD, useClass: JwtAuthGuard },
          { provide: APP_GUARD, useClass: RolesGuard },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      app.use(cookieParser());
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
      );
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      try {
        const jwtService = moduleRef.get(JwtService);
        const token = await jwtService.signAsync({
          sub: userId,
          email: fakeUser.email,
          role: fakeUser.role,
          jti,
        });

        await request(app.getHttpServer() as App)
          .post('/api/auth/logout')
          .expect(401);

        const logoutRes = await request(app.getHttpServer() as App)
          .post('/api/auth/logout')
          .set('Cookie', [`access_token=${token}`])
          .expect(200);

        expect(logoutRes.body).toEqual({ message: 'Logged out successfully' });
        expect(sessionRevokedAt).toBeInstanceOf(Date);
        const setCookieHeader = logoutRes.headers['set-cookie'];
        expect(Array.isArray(setCookieHeader)).toBe(true);
        expect(setCookieHeader[0]).toContain('access_token=;');
        expect(setCookieHeader[0]).toContain('HttpOnly');

        await request(app.getHttpServer() as App)
          .post('/api/auth/logout')
          .set('Cookie', [`access_token=${token}`])
          .expect(401);
      } finally {
        await app.close();
      }
    });
  });
  describe('changePassword', () => {
    it('requires authentication (not marked @Public())', () => {
      const reflector = new Reflector();
      const handler = Object.getOwnPropertyDescriptor(
        AuthController.prototype,
        'changePassword',
      )?.value as (...args: never[]) => unknown;
      const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, handler);
      expect(isPublic).toBeUndefined();
    });

    it('delegates valid ChangePasswordDto to AuthService.changePassword', async () => {
      const expected = {
        message: 'Password changed successfully',
        mustChangePassword: false,
        revokedOtherSessionsCount: 1,
      };
      mockAuthService.changePassword.mockResolvedValue(expected);

      const dto = (await validationPipe.transform(
        {
          currentPassword: 'OldPass123!',
          newPassword: 'NewStrongPass456!',
          revokeOtherSessions: false,
        },
        { type: 'body', metatype: ChangePasswordDto },
      )) as ChangePasswordDto;

      const user = {
        userId: '507f1f77bcf86cd799439011',
        email: 'traveler@example.com',
        role: Role.REGISTERED_USER,
        jti: 'current-jti',
      };

      const result = await controller.changePassword(user, dto);
      expect(dto.revokeOtherSessions).toBe(false);
      expect(mockAuthService.changePassword).toHaveBeenCalledWith(user, dto);
      expect(result).toEqual(expected);
    });

    it('rejects weak newPassword and non-whitelisted properties', async () => {
      await expect(
        validationPipe.transform(
          { currentPassword: 'OldPass123!', newPassword: 'weak' },
          { type: 'body', metatype: ChangePasswordDto },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        validationPipe.transform(
          {
            currentPassword: 'OldPass123!',
            newPassword: 'NewStrongPass456!',
            mustChangePassword: false,
          },
          { type: 'body', metatype: ChangePasswordDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('HTTP integration (ACC-08 change-password, ACC-04/19 me)', () => {
    it('updates password, clears mustChangePassword, revokes other sessions while keeping caller session active', async () => {
      const userId = '507f1f77bcf86cd799439011';
      const currentJti = 'current-session-jti';
      const otherJti = 'other-session-jti';
      const initialHash = await bcrypt.hash('OldStrongPass123!', 4);

      const userState = {
        _id: userId,
        email: 'traveler@example.com',
        role: Role.REGISTERED_USER,
        status: AccountStatus.ACTIVE,
        passwordHash: initialHash,
        mustChangePassword: true,
      };

      const sessions = new Map<
        string,
        {
          _id: string;
          user: string;
          jti: string;
          expiresAt: Date;
          revokedAt: Date | null;
        }
      >([
        [
          currentJti,
          {
            _id: 's1',
            user: userId,
            jti: currentJti,
            expiresAt: new Date(Date.now() + 3600_000),
            revokedAt: null,
          },
        ],
        [
          otherJti,
          {
            _id: 's2',
            user: userId,
            jti: otherJti,
            expiresAt: new Date(Date.now() + 3600_000),
            revokedAt: null,
          },
        ],
      ]);

      const fakeUserModel = {
        findById: jest.fn(() =>
          Object.assign(Promise.resolve(userState), {
            select: jest.fn().mockResolvedValue(userState),
            lean: jest.fn().mockResolvedValue(userState),
          }),
        ),
        findByIdAndUpdate: jest.fn(
          (
            _id: string,
            update: {
              $set: { passwordHash: string; mustChangePassword: boolean };
            },
          ) => {
            userState.passwordHash = update.$set.passwordHash;
            userState.mustChangePassword = update.$set.mustChangePassword;
            return Promise.resolve(userState);
          },
        ),
      };

      const fakeSessionModel = {
        findOne: jest.fn((filter: { jti?: string; user?: string }) => ({
          lean: jest
            .fn()
            .mockResolvedValue(
              filter.jti ? (sessions.get(filter.jti) ?? null) : null,
            ),
        })),
        updateMany: jest.fn(
          (
            filter: { user?: string; jti?: { $ne?: string }; revokedAt?: null },
            update: { $set: { revokedAt: Date } },
          ) => {
            let count = 0;
            for (const s of sessions.values()) {
              if (
                s.user === filter.user &&
                s.jti !== filter.jti?.$ne &&
                s.revokedAt === null
              ) {
                s.revokedAt = update.$set.revokedAt;
                count += 1;
              }
            }
            return Promise.resolve({ modifiedCount: count });
          },
        ),
      };

      const configValues: Record<string, unknown> = {
        'jwt.secret': 'test-jwt-secret',
        'jwt.expiresIn': '1d',
        'jwt.cookieName': 'access_token',
        'jwt.cookieSecure': false,
      };
      const fakeConfigService = {
        get: jest.fn((key: string, defaultValue?: unknown) =>
          key in configValues ? configValues[key] : defaultValue,
        ),
      };

      const moduleRef = await Test.createTestingModule({
        imports: [
          PassportModule.register({ defaultStrategy: 'jwt' }),
          JwtModule.register({
            secret: 'test-jwt-secret',
            signOptions: { expiresIn: '1d' },
          }),
        ],
        controllers: [AuthController],
        providers: [
          AuthService,
          JwtStrategy,
          { provide: ConfigService, useValue: fakeConfigService },
          { provide: getModelToken(User.name), useValue: fakeUserModel },
          {
            provide: getModelToken(UserSession.name),
            useValue: fakeSessionModel,
          },
          {
            provide: getModelToken(ModeratorAssignment.name),
            useValue: { findOne: jest.fn() },
          },
          {
            provide: ReferenceDataService,
            useValue: { isCurrencySupported: jest.fn() },
          },
          {
            provide: MailService,
            useValue: { sendVerificationEmail: jest.fn() },
          },
          { provide: APP_GUARD, useClass: JwtAuthGuard },
          { provide: APP_GUARD, useClass: RolesGuard },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      app.use(cookieParser());
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
      );
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      try {
        const jwtService = moduleRef.get(JwtService);
        const currentCookie = await jwtService.signAsync({
          sub: userId,
          email: userState.email,
          role: userState.role,
          jti: currentJti,
        });
        const otherCookie = await jwtService.signAsync({
          sub: userId,
          email: userState.email,
          role: userState.role,
          jti: otherJti,
        });

        await request(app.getHttpServer() as App)
          .patch('/api/auth/change-password')
          .send({
            currentPassword: 'OldStrongPass123!',
            newPassword: 'NewStrongPass456!',
          })
          .expect(401);

        const res = await request(app.getHttpServer() as App)
          .patch('/api/auth/change-password')
          .set('Cookie', [`access_token=${currentCookie}`])
          .send({
            currentPassword: 'OldStrongPass123!',
            newPassword: 'NewStrongPass456!',
          })
          .expect(200);

        expect(res.body).toEqual({
          message: 'Password changed successfully',
          mustChangePassword: false,
          revokedOtherSessionsCount: 1,
        });
        expect(userState.mustChangePassword).toBe(false);
        await expect(
          bcrypt.compare('NewStrongPass456!', userState.passwordHash),
        ).resolves.toBe(true);

        // Current session remains valid while other session is revoked
        await request(app.getHttpServer() as App)
          .get('/api/auth/me')
          .set('Cookie', [`access_token=${currentCookie}`])
          .expect(200);

        await request(app.getHttpServer() as App)
          .get('/api/auth/me')
          .set('Cookie', [`access_token=${otherCookie}`])
          .expect(401);
      } finally {
        await app.close();
      }
    });
  });
  describe('me', () => {
    it('requires authentication (not marked @Public())', () => {
      const reflector = new Reflector();
      const handler = Object.getOwnPropertyDescriptor(
        AuthController.prototype,
        'me',
      )?.value as (...args: never[]) => unknown;
      const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, handler);
      expect(isPublic).toBeUndefined();
    });

    it('delegates CurrentUser to AuthService.getMe', async () => {
      const expected = {
        id: '507f1f77bcf86cd799439011',
        email: 'mod@example.com',
        firstName: 'Airline',
        lastName: 'Moderator',
        preferredCurrency: 'USD',
        role: Role.AIRLINE_MODERATOR,
        status: AccountStatus.ACTIVE,
        isEmailVerified: true,
        mustChangePassword: false,
        assignedProviderId: '507f1f77bcf86cd799439099',
        assignedProviderType: ProviderType.AIRLINE,
      };
      mockAuthService.getMe.mockResolvedValue(expected);

      const authUser = {
        userId: '507f1f77bcf86cd799439011',
        email: 'mod@example.com',
        role: Role.AIRLINE_MODERATOR,
        jti: 'jti-123',
        assignedProviderId: '507f1f77bcf86cd799439099',
        assignedProviderType: ProviderType.AIRLINE,
      };

      const result = await controller.me(authUser);
      expect(mockAuthService.getMe).toHaveBeenCalledWith(authUser);
      expect(result).toEqual(expected);
    });
  });

  describe('HTTP integration (ACC-04, ACC-19 GET /api/auth/me)', () => {
    it('returns 401 when unauthenticated, returns safe user details for traveler, and includes provider context for moderators', async () => {
      const travelerId = '507f1f77bcf86cd799439011';
      const modId = '507f1f77bcf86cd799439022';
      const airlineId = '507f1f77bcf86cd799439099';

      const users = new Map<string, Record<string, unknown>>([
        [
          travelerId,
          {
            _id: travelerId,
            email: 'traveler@example.com',
            firstName: 'Abdelaziz',
            lastName: 'Mohamed',
            preferredCurrency: 'EGP',
            role: Role.REGISTERED_USER,
            status: AccountStatus.ACTIVE,
            isEmailVerified: true,
            mustChangePassword: false,
            passwordHash: 'secret-hash',
            passwordResetToken: 'secret-reset',
          },
        ],
        [
          modId,
          {
            _id: modId,
            email: 'airline-mod@example.com',
            firstName: 'Airline',
            lastName: 'Moderator',
            preferredCurrency: 'USD',
            role: Role.AIRLINE_MODERATOR,
            status: AccountStatus.ACTIVE,
            isEmailVerified: true,
            mustChangePassword: true,
            passwordHash: 'secret-hash',
          },
        ],
      ]);

      const fakeUserModel = {
        findById: jest.fn((id: string) => {
          const user = users.get(id) ?? null;
          return Object.assign(Promise.resolve(user), {
            lean: jest.fn().mockResolvedValue(user),
          });
        }),
      };

      const fakeSessionModel = {
        findOne: jest.fn(({ jti, user }: { jti: string; user: string }) => ({
          lean: jest.fn().mockResolvedValue({
            _id: `session-${jti}`,
            user,
            jti,
            expiresAt: new Date(Date.now() + 3600_000),
            revokedAt: null,
          }),
        })),
      };

      const fakeAssignmentModel = {
        findOne: jest.fn(({ moderator }: { moderator: string }) => ({
          lean: jest.fn().mockResolvedValue(
            moderator === modId
              ? {
                  _id: 'assign-1',
                  moderator: modId,
                  providerType: ProviderType.AIRLINE,
                  airline: airlineId,
                  isActive: true,
                }
              : null,
          ),
        })),
      };

      const configValues: Record<string, unknown> = {
        'jwt.secret': 'test-jwt-secret',
        'jwt.expiresIn': '1d',
        'jwt.cookieName': 'access_token',
        'jwt.cookieSecure': false,
      };
      const fakeConfigService = {
        get: jest.fn((key: string, defaultValue?: unknown) =>
          key in configValues ? configValues[key] : defaultValue,
        ),
      };

      const moduleRef = await Test.createTestingModule({
        imports: [
          PassportModule.register({ defaultStrategy: 'jwt' }),
          JwtModule.register({
            secret: 'test-jwt-secret',
            signOptions: { expiresIn: '1d' },
          }),
        ],
        controllers: [AuthController],
        providers: [
          AuthService,
          JwtStrategy,
          { provide: ConfigService, useValue: fakeConfigService },
          { provide: getModelToken(User.name), useValue: fakeUserModel },
          {
            provide: getModelToken(UserSession.name),
            useValue: fakeSessionModel,
          },
          {
            provide: getModelToken(ModeratorAssignment.name),
            useValue: fakeAssignmentModel,
          },
          {
            provide: ReferenceDataService,
            useValue: { isCurrencySupported: jest.fn() },
          },
          {
            provide: MailService,
            useValue: { sendVerificationEmail: jest.fn() },
          },
          { provide: APP_GUARD, useClass: JwtAuthGuard },
          { provide: APP_GUARD, useClass: RolesGuard },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      app.use(cookieParser());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      try {
        const jwtService = moduleRef.get(JwtService);
        const travelerToken = await jwtService.signAsync({
          sub: travelerId,
          email: 'traveler@example.com',
          role: Role.REGISTERED_USER,
          jti: 'jti-traveler',
        });
        const modToken = await jwtService.signAsync({
          sub: modId,
          email: 'airline-mod@example.com',
          role: Role.AIRLINE_MODERATOR,
          jti: 'jti-mod',
        });

        await request(app.getHttpServer() as App)
          .get('/api/auth/me')
          .expect(401);

        const travelerRes = await request(app.getHttpServer() as App)
          .get('/api/auth/me')
          .set('Cookie', [`access_token=${travelerToken}`])
          .expect(200);

        expect(travelerRes.body).toEqual({
          id: travelerId,
          email: 'traveler@example.com',
          firstName: 'Abdelaziz',
          lastName: 'Mohamed',
          preferredCurrency: 'EGP',
          role: Role.REGISTERED_USER,
          status: AccountStatus.ACTIVE,
          isEmailVerified: true,
          mustChangePassword: false,
        });
        expect(
          (travelerRes.body as Record<string, unknown>).passwordHash,
        ).toBeUndefined();
        expect(
          (travelerRes.body as Record<string, unknown>).passwordResetToken,
        ).toBeUndefined();

        const modRes = await request(app.getHttpServer() as App)
          .get('/api/auth/me')
          .set('Authorization', `Bearer ${modToken}`)
          .expect(200);

        expect(modRes.body).toMatchObject({
          id: modId,
          role: Role.AIRLINE_MODERATOR,
          status: AccountStatus.ACTIVE,
          mustChangePassword: true,
          assignedProviderId: airlineId,
          assignedProviderType: ProviderType.AIRLINE,
        });
      } finally {
        await app.close();
      }
    });
  });
});
