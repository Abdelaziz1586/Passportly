import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
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
import { User } from '../users/schemas/user.schema';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailQueryDto } from './dto/verify-email-query.dto';
import { UserSession } from './schemas/user-session.schema';

describe('AuthController (ACC-01 register, ACC-02 verify-email, ACC-04/05 login, ACC-07 forgot-password)', () => {
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
    forgotPassword: jest.fn(),
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
});
