import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountStatus, Role } from '../../common/enums';
import { UserSession } from '../auth/schemas/user-session.schema';
import { ModeratorAssignment } from './schemas/moderator-assignment.schema';
import { User } from './schemas/user.schema';
import { UsersService } from './users.service';

describe('UsersService (ACC-12 deactivateMyAccount)', () => {
  let service: UsersService;

  const mockUserModel = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };

  const mockSessionModel = {
    updateMany: jest.fn(),
  };

  const userId = '507f1f77bcf86cd799439011';
  const travelerUser = {
    userId,
    email: 'traveler@example.com',
    role: Role.REGISTERED_USER,
    jti: 'jti-1',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
        {
          provide: getModelToken(ModeratorAssignment.name),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getModelToken(UserSession.name),
          useValue: mockSessionModel,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const values: Record<string, unknown> = {
                'jwt.cookieName': 'access_token',
                'jwt.cookieSecure': false,
              };
              return key in values ? values[key] : defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('sets status = DEACTIVATED, records deactivatedAt, revokes active sessions, and returns clearCookie options', async () => {
    mockUserModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: userId,
        email: 'traveler@example.com',
        role: Role.REGISTERED_USER,
        status: AccountStatus.ACTIVE,
      }),
    });
    mockUserModel.findByIdAndUpdate.mockResolvedValue({
      _id: userId,
      status: AccountStatus.DEACTIVATED,
    });
    mockSessionModel.updateMany.mockResolvedValue({ modifiedCount: 2 });

    const result = await service.deactivateMyAccount(travelerUser);

    expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
      userId,
      {
        $set: {
          status: AccountStatus.DEACTIVATED,
          deactivatedAt: expect.any(Date) as Date,
        },
      },
      { returnDocument: 'after' },
    );
    expect(mockSessionModel.updateMany).toHaveBeenCalledWith(
      { user: userId, revokedAt: null },
      { $set: { revokedAt: expect.any(Date) as Date } },
    );
    expect(result.response.message).toBe('Account deactivated successfully');
    expect(result.response.status).toBe(AccountStatus.DEACTIVATED);
    expect(result.response.deactivatedAt).toBeInstanceOf(Date);
    expect(result.cookieName).toBe('access_token');
    expect(result.clearCookieOptions).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
    });
  });

  it('rejects non-traveler roles (ADMIN, moderators), invalid IDs, missing users, and inactive accounts', async () => {
    await expect(
      service.deactivateMyAccount({
        ...travelerUser,
        role: Role.ADMIN,
      }),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      service.deactivateMyAccount({
        ...travelerUser,
        userId: 'bad-id',
      }),
    ).rejects.toThrow(UnauthorizedException);

    mockUserModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    await expect(service.deactivateMyAccount(travelerUser)).rejects.toThrow(
      NotFoundException,
    );

    mockUserModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: userId,
        role: Role.REGISTERED_USER,
        status: AccountStatus.DEACTIVATED,
      }),
    });
    await expect(service.deactivateMyAccount(travelerUser)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
