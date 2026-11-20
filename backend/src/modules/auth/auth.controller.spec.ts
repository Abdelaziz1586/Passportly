import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Request, Response } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AccountStatus, Role } from '../../common/enums';
import { AllExceptionsFilter } from '../../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { MailService } from '../mail/mail.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { ModeratorAssignment } from '../users/schemas/moderator-assignment.schema';
import { User } from '../users/schemas/user.schema';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailQueryDto } from './dto/verify-email-query.dto';
import { UserSession } from './schemas/user-session.schema';
import { JwtStrategy } from './strategies/jwt.strategy';

describe('AuthController (ACC-01 register, ACC-02 verify-email, ACC-04/05 login, ACC-06 logout)', () => {
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
});
