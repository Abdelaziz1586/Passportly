import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Response } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AccountStatus, ProviderType, Role } from '../../common/enums';
import { AllExceptionsFilter } from '../../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserSession } from '../auth/schemas/user-session.schema';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ModeratorAssignment } from './schemas/moderator-assignment.schema';
import { User } from './schemas/user.schema';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController (ACC-11 GET /api/users/me)', () => {
  let controller: UsersController;
  const mockUsersService = {
    getMyProfile: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('requires authentication on GET /api/users/me (not marked @Public())', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      UsersController.prototype,
      'getMyProfile',
    )?.value as (...args: never[]) => unknown;
    const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, handler);
    expect(isPublic).toBeUndefined();
  });

  it('delegates CurrentUser to UsersService.getMyProfile', async () => {
    const expected = {
      id: '507f1f77bcf86cd799439011',
      email: 'traveler@example.com',
      firstName: 'Abdelaziz',
      lastName: 'Mohamed',
      preferredCurrency: 'USD',
      role: Role.REGISTERED_USER,
      status: AccountStatus.ACTIVE,
      isEmailVerified: true,
      mustChangePassword: false,
    };
    mockUsersService.getMyProfile.mockResolvedValue(expected);

    const user = {
      userId: '507f1f77bcf86cd799439011',
      email: 'traveler@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    };

    const result = await controller.getMyProfile(user);
    expect(mockUsersService.getMyProfile).toHaveBeenCalledWith(user);
    expect(result).toEqual(expected);
  });

  describe('HTTP integration (ACC-11 GET /api/users/me)', () => {
    it('returns 401 when unauthenticated, 200 with full sanitized profile for traveler, and includes moderatorAssignment for moderators', async () => {
      const travelerId = '507f1f77bcf86cd799439011';
      const modId = '507f1f77bcf86cd799439022';
      const hotelId = '507f1f77bcf86cd799439077';
      const adminId = '507f1f77bcf86cd799439001';

      const users = new Map<string, Record<string, unknown>>([
        [
          travelerId,
          {
            _id: travelerId,
            email: 'traveler@example.com',
            firstName: 'Abdelaziz',
            lastName: 'Mohamed',
            bio: 'Travel planner',
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
            email: 'hotel-mod@example.com',
            firstName: 'Hotel',
            lastName: 'Mod',
            preferredCurrency: 'USD',
            role: Role.HOTEL_MODERATOR,
            status: AccountStatus.ACTIVE,
            isEmailVerified: true,
            mustChangePassword: false,
          },
        ],
      ]);

      const fakeUserModel = {
        findById: jest.fn((id: string) => {
          const user = users.get(id) ?? null;
          return {
            select: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue(user),
            }),
            lean: jest.fn().mockResolvedValue(user),
          };
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
                  _id: '507f1f77bcf86cd799439088',
                  moderator: modId,
                  providerType: ProviderType.HOTEL,
                  hotel: hotelId,
                  assignedBy: adminId,
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
        controllers: [UsersController],
        providers: [
          UsersService,
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
            useValue: {
              isCurrencySupported: jest.fn(() => Promise.resolve(true)),
            },
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
          jti: 'jti-t',
        });
        const modToken = await jwtService.signAsync({
          sub: modId,
          email: 'hotel-mod@example.com',
          role: Role.HOTEL_MODERATOR,
          jti: 'jti-m',
        });

        await request(app.getHttpServer() as App)
          .get('/api/users/me')
          .expect(401);

        const travelerRes = await request(app.getHttpServer() as App)
          .get('/api/users/me')
          .set('Cookie', [`access_token=${travelerToken}`])
          .expect(200);

        expect(travelerRes.body).toMatchObject({
          id: travelerId,
          email: 'traveler@example.com',
          bio: 'Travel planner',
          preferredCurrency: 'EGP',
          role: Role.REGISTERED_USER,
        });
        expect(
          (travelerRes.body as Record<string, unknown>).passwordHash,
        ).toBeUndefined();
        expect(
          (travelerRes.body as Record<string, unknown>).passwordResetToken,
        ).toBeUndefined();

        const modRes = await request(app.getHttpServer() as App)
          .get('/api/users/me')
          .set('Cookie', [`access_token=${modToken}`])
          .expect(200);

        expect(modRes.body).toMatchObject({
          id: modId,
          role: Role.HOTEL_MODERATOR,
          moderatorAssignment: {
            id: '507f1f77bcf86cd799439088',
            providerType: ProviderType.HOTEL,
            providerId: hotelId,
            hotelId,
            assignedBy: adminId,
            isActive: true,
          },
        });
      } finally {
        await app.close();
      }
    });
  });
});

describe('UsersController (ACC-09 PATCH /api/users/me)', () => {
  let controller: UsersController;
  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockUsersService = {
    updateMyProfile: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('requires authentication on PATCH /api/users/me', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      UsersController.prototype,
      'updateMyProfile',
    )?.value as (...args: never[]) => unknown;
    const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, handler);
    expect(isPublic).toBeUndefined();
  });

  it('forbids role, status, and email edits via ValidationPipe forbidNonWhitelisted', async () => {
    await expect(
      validationPipe.transform(
        { firstName: 'Hack', role: 'ADMIN' },
        { type: 'body', metatype: UpdateProfileDto },
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      validationPipe.transform(
        { status: 'SUSPENDED' },
        { type: 'body', metatype: UpdateProfileDto },
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      validationPipe.transform(
        { email: 'new@example.com' },
        { type: 'body', metatype: UpdateProfileDto },
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      validationPipe.transform(
        { firstName: '   ' },
        { type: 'body', metatype: UpdateProfileDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('delegates valid UpdateProfileDto to UsersService.updateMyProfile', async () => {
    const expected = {
      id: '507f1f77bcf86cd799439011',
      email: 'traveler@example.com',
      firstName: 'Abdelaziz',
      lastName: 'Mohamed',
      preferredCurrency: 'EGP',
      role: Role.REGISTERED_USER,
      status: AccountStatus.ACTIVE,
      isEmailVerified: true,
      mustChangePassword: false,
    };
    mockUsersService.updateMyProfile.mockResolvedValue(expected);

    const dto = (await validationPipe.transform(
      {
        firstName: '  Abdelaziz ',
        preferredCurrency: 'egp',
        nationality: 'eg',
      },
      { type: 'body', metatype: UpdateProfileDto },
    )) as UpdateProfileDto;

    const user = {
      userId: '507f1f77bcf86cd799439011',
      email: 'traveler@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    };

    const result = await controller.updateMyProfile(user, dto);
    expect(dto.firstName).toBe('Abdelaziz');
    expect(dto.preferredCurrency).toBe('EGP');
    expect(dto.nationality).toBe('EG');
    expect(mockUsersService.updateMyProfile).toHaveBeenCalledWith(user, dto);
    expect(result).toEqual(expected);
  });

  describe('HTTP integration (ACC-09 PATCH /api/users/me)', () => {
    it('updates profile with valid currency, rejects unsupported currency, and forbids role/status edits', async () => {
      const userId = '507f1f77bcf86cd799439011';
      const userState: Record<string, unknown> = {
        _id: userId,
        email: 'traveler@example.com',
        firstName: 'Old',
        lastName: 'Name',
        preferredCurrency: 'USD',
        role: Role.REGISTERED_USER,
        status: AccountStatus.ACTIVE,
        isEmailVerified: true,
        mustChangePassword: false,
      };

      const fakeUserModel = {
        findById: jest.fn(() => ({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue({ ...userState }),
          }),
          lean: jest.fn().mockResolvedValue({ ...userState }),
        })),
        findByIdAndUpdate: jest.fn(
          (
            _id: string,
            update: {
              $set?: Record<string, unknown>;
              $unset?: Record<string, 1>;
            },
          ) => {
            if (update.$set) {
              Object.assign(userState, update.$set);
            }
            if (update.$unset) {
              for (const key of Object.keys(update.$unset)) {
                delete userState[key];
              }
            }
            return {
              select: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue({ ...userState }),
              }),
            };
          },
        ),
      };

      const fakeSessionModel = {
        findOne: jest.fn(({ jti, user }: { jti: string; user: string }) => ({
          lean: jest.fn().mockResolvedValue({
            _id: 'session-1',
            user,
            jti,
            expiresAt: new Date(Date.now() + 3600_000),
            revokedAt: null,
          }),
        })),
      };

      const configValues: Record<string, unknown> = {
        'jwt.secret': 'test-jwt-secret',
        'jwt.expiresIn': '1d',
        'jwt.cookieName': 'access_token',
        'jwt.cookieSecure': false,
      };

      const moduleRef = await Test.createTestingModule({
        imports: [
          PassportModule.register({ defaultStrategy: 'jwt' }),
          JwtModule.register({
            secret: 'test-jwt-secret',
            signOptions: { expiresIn: '1d' },
          }),
        ],
        controllers: [UsersController],
        providers: [
          UsersService,
          JwtStrategy,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((k: string, d?: unknown) =>
                k in configValues ? configValues[k] : d,
              ),
            },
          },
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
            useValue: {
              isCurrencySupported: jest.fn((code: string) =>
                Promise.resolve(['USD', 'EGP', 'EUR'].includes(code)),
              ),
            },
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
          email: 'traveler@example.com',
          role: Role.REGISTERED_USER,
          jti: 'jti-1',
        });

        await request(app.getHttpServer() as App)
          .patch('/api/users/me')
          .send({ firstName: 'New' })
          .expect(401);

        // Forbidden role/status edits rejected by ValidationPipe
        await request(app.getHttpServer() as App)
          .patch('/api/users/me')
          .set('Cookie', [`access_token=${token}`])
          .send({ role: Role.ADMIN })
          .expect(400);

        await request(app.getHttpServer() as App)
          .patch('/api/users/me')
          .set('Cookie', [`access_token=${token}`])
          .send({ status: AccountStatus.SUSPENDED })
          .expect(400);

        // Unsupported currency rejected
        await request(app.getHttpServer() as App)
          .patch('/api/users/me')
          .set('Cookie', [`access_token=${token}`])
          .send({ preferredCurrency: 'ZZZ' })
          .expect(400);

        // Valid update succeeds
        const res = await request(app.getHttpServer() as App)
          .patch('/api/users/me')
          .set('Cookie', [`access_token=${token}`])
          .send({
            firstName: 'Abdelaziz',
            bio: 'Passionate traveler',
            avatarUrl: 'https://cdn.example.com/avatar.png',
            preferredCurrency: 'egp',
            nationality: 'eg',
          })
          .expect(200);

        expect(res.body).toMatchObject({
          id: userId,
          firstName: 'Abdelaziz',
          bio: 'Passionate traveler',
          avatarUrl: 'https://cdn.example.com/avatar.png',
          preferredCurrency: 'EGP',
          nationality: 'EG',
          role: Role.REGISTERED_USER,
          status: AccountStatus.ACTIVE,
        });
      } finally {
        await app.close();
      }
    });
  });
});

describe('UsersController (ACC-12 DELETE /api/users/me)', () => {
  let controller: UsersController;
  const mockUsersService = {
    deactivateMyAccount: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('requires authentication and restricts DELETE /api/users/me to Role.REGISTERED_USER', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      UsersController.prototype,
      'deactivateMyAccount',
    )?.value as (...args: never[]) => unknown;
    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(reflector.get<Role[]>(ROLES_KEY, handler)).toEqual([
      Role.REGISTERED_USER,
    ]);
  });

  it('clears httpOnly cookie and returns deactivation payload', async () => {
    const deactivatedAt = new Date('2026-11-19T18:15:00.000Z');
    const clearCookieOptions = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: false,
      path: '/',
    };
    mockUsersService.deactivateMyAccount.mockResolvedValue({
      response: {
        message: 'Account deactivated successfully',
        status: AccountStatus.DEACTIVATED,
        deactivatedAt,
      },
      cookieName: 'access_token',
      clearCookieOptions,
    });

    const clearCookieMock = jest.fn();
    const res = { clearCookie: clearCookieMock } as unknown as Response;
    const user = {
      userId: '507f1f77bcf86cd799439011',
      email: 'traveler@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    };

    const result = await controller.deactivateMyAccount(user, res);
    expect(mockUsersService.deactivateMyAccount).toHaveBeenCalledWith(user);
    expect(clearCookieMock).toHaveBeenCalledWith(
      'access_token',
      clearCookieOptions,
    );
    expect(result).toEqual({
      message: 'Account deactivated successfully',
      status: AccountStatus.DEACTIVATED,
      deactivatedAt,
    });
  });

  describe('HTTP integration (ACC-12 DELETE /api/users/me)', () => {
    it('enforces REGISTERED_USER role, deactivates account, revokes sessions, clears cookie, and blocks reuse', async () => {
      const travelerId = '507f1f77bcf86cd799439011';
      const adminId = '507f1f77bcf86cd799439001';

      const users = new Map<
        string,
        {
          _id: string;
          email: string;
          role: Role;
          status: AccountStatus;
          deactivatedAt?: Date;
        }
      >([
        [
          travelerId,
          {
            _id: travelerId,
            email: 'traveler@example.com',
            role: Role.REGISTERED_USER,
            status: AccountStatus.ACTIVE,
          },
        ],
        [
          adminId,
          {
            _id: adminId,
            email: 'admin@example.com',
            role: Role.ADMIN,
            status: AccountStatus.ACTIVE,
          },
        ],
      ]);

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
          'jti-traveler',
          {
            _id: 's-1',
            user: travelerId,
            jti: 'jti-traveler',
            expiresAt: new Date(Date.now() + 3600_000),
            revokedAt: null,
          },
        ],
        [
          'jti-admin',
          {
            _id: 's-2',
            user: adminId,
            jti: 'jti-admin',
            expiresAt: new Date(Date.now() + 3600_000),
            revokedAt: null,
          },
        ],
      ]);

      const fakeUserModel = {
        findById: jest.fn((id: string) => ({
          lean: jest.fn().mockResolvedValue(users.get(id) ?? null),
        })),
        findByIdAndUpdate: jest.fn(
          (
            id: string,
            update: { $set: { status: AccountStatus; deactivatedAt: Date } },
          ) => {
            const doc = users.get(id);
            if (doc) {
              doc.status = update.$set.status;
              doc.deactivatedAt = update.$set.deactivatedAt;
            }
            return Promise.resolve(doc ?? null);
          },
        ),
      };

      const fakeSessionModel = {
        findOne: jest.fn(({ jti }: { jti: string }) => ({
          lean: jest.fn().mockResolvedValue(sessions.get(jti) ?? null),
        })),
        updateMany: jest.fn(
          (
            filter: { user: string; revokedAt: null },
            update: { $set: { revokedAt: Date } },
          ) => {
            let count = 0;
            for (const s of sessions.values()) {
              if (s.user === filter.user && s.revokedAt === null) {
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

      const moduleRef = await Test.createTestingModule({
        imports: [
          PassportModule.register({ defaultStrategy: 'jwt' }),
          JwtModule.register({
            secret: 'test-jwt-secret',
            signOptions: { expiresIn: '1d' },
          }),
        ],
        controllers: [UsersController],
        providers: [
          UsersService,
          JwtStrategy,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((k: string, d?: unknown) =>
                k in configValues ? configValues[k] : d,
              ),
            },
          },
          { provide: getModelToken(User.name), useValue: fakeUserModel },
          {
            provide: getModelToken(ModeratorAssignment.name),
            useValue: { findOne: jest.fn() },
          },
          {
            provide: ReferenceDataService,
            useValue: {
              isCurrencySupported: jest.fn(() => Promise.resolve(true)),
            },
          },
          {
            provide: getModelToken(UserSession.name),
            useValue: fakeSessionModel,
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
        const adminToken = await jwtService.signAsync({
          sub: adminId,
          email: 'admin@example.com',
          role: Role.ADMIN,
          jti: 'jti-admin',
        });

        await request(app.getHttpServer() as App)
          .delete('/api/users/me')
          .expect(401);

        // ADMIN forbidden by RolesGuard
        await request(app.getHttpServer() as App)
          .delete('/api/users/me')
          .set('Cookie', [`access_token=${adminToken}`])
          .expect(403);

        const res = await request(app.getHttpServer() as App)
          .delete('/api/users/me')
          .set('Cookie', [`access_token=${travelerToken}`])
          .expect(200);

        expect(res.body).toMatchObject({
          message: 'Account deactivated successfully',
          status: AccountStatus.DEACTIVATED,
        });
        expect(users.get(travelerId)?.status).toBe(AccountStatus.DEACTIVATED);
        expect(users.get(travelerId)?.deactivatedAt).toBeInstanceOf(Date);
        expect(sessions.get('jti-traveler')?.revokedAt).toBeInstanceOf(Date);

        const setCookieHeader = res.headers['set-cookie'];
        expect(Array.isArray(setCookieHeader)).toBe(true);
        expect(setCookieHeader[0]).toContain('access_token=;');
        expect(setCookieHeader[0]).toContain('HttpOnly');

        // Reusing deactivated/revoked cookie is rejected
        await request(app.getHttpServer() as App)
          .delete('/api/users/me')
          .set('Cookie', [`access_token=${travelerToken}`])
          .expect(401);
      } finally {
        await app.close();
      }
    });
  });
});
