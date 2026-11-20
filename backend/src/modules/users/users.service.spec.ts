import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountStatus, ProviderType, Role } from '../../common/enums';
import { UserSession } from '../auth/schemas/user-session.schema';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { ModeratorAssignment } from './schemas/moderator-assignment.schema';
import { User } from './schemas/user.schema';
import { UsersService } from './users.service';

describe('UsersService (ACC-11 getMyProfile)', () => {
  let service: UsersService;

  const mockUserModel = {
    findById: jest.fn(),
  };

  const mockAssignmentModel = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
        {
          provide: getModelToken(ModeratorAssignment.name),
          useValue: mockAssignmentModel,
        },
        {
          provide: ReferenceDataService,
          useValue: { isCurrencySupported: jest.fn() },
        },
        {
          provide: getModelToken(UserSession.name),
          useValue: { updateMany: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('fetches full sanitized traveler profile and excludes sensitive tokens/hash', async () => {
    const userId = '507f1f77bcf86cd799439011';
    const createdAt = new Date('2026-11-17T10:00:00.000Z');
    const updatedAt = new Date('2026-11-19T10:00:00.000Z');
    const leanMock = jest.fn().mockResolvedValue({
      _id: userId,
      email: 'traveler@example.com',
      firstName: 'Abdelaziz',
      lastName: 'Mohamed',
      phone: '+201001234567',
      avatarUrl: 'https://cdn.example.com/a.png',
      bio: 'Explorer',
      nationality: 'EG',
      preferredCurrency: 'EGP',
      role: Role.REGISTERED_USER,
      status: AccountStatus.ACTIVE,
      isEmailVerified: true,
      mustChangePassword: false,
      passwordHash: 'should-never-leak',
      emailVerificationToken: 'should-never-leak',
      passwordResetToken: 'should-never-leak',
      passwordResetExpiresAt: new Date(),
      createdAt,
      updatedAt,
    });
    const selectMock = jest.fn().mockReturnValue({ lean: leanMock });
    mockUserModel.findById.mockReturnValue({ select: selectMock });

    const result = await service.getMyProfile({
      userId,
      email: 'traveler@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    });

    expect(mockUserModel.findById).toHaveBeenCalledWith(userId);
    expect(selectMock).toHaveBeenCalledWith(
      '-passwordHash -emailVerificationToken -passwordResetToken -passwordResetExpiresAt',
    );
    expect(mockAssignmentModel.findOne).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: userId,
      email: 'traveler@example.com',
      firstName: 'Abdelaziz',
      lastName: 'Mohamed',
      phone: '+201001234567',
      avatarUrl: 'https://cdn.example.com/a.png',
      bio: 'Explorer',
      nationality: 'EG',
      preferredCurrency: 'EGP',
      role: Role.REGISTERED_USER,
      status: AccountStatus.ACTIVE,
      isEmailVerified: true,
      mustChangePassword: false,
      createdAt,
      updatedAt,
    });
    expect('passwordHash' in result).toBe(false);
    expect('emailVerificationToken' in result).toBe(false);
    expect('passwordResetToken' in result).toBe(false);
    expect('passwordResetExpiresAt' in result).toBe(false);
  });

  it('includes active moderator assignment for AIRLINE_MODERATOR and HOTEL_MODERATOR', async () => {
    const modId = '507f1f77bcf86cd799439022';
    const airlineId = '507f1f77bcf86cd799439099';
    const adminId = '507f1f77bcf86cd799439001';

    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: modId,
          email: 'mod@airline.com',
          firstName: 'Airline',
          lastName: 'Mod',
          preferredCurrency: 'USD',
          role: Role.AIRLINE_MODERATOR,
          status: AccountStatus.ACTIVE,
          isEmailVerified: true,
          mustChangePassword: true,
        }),
      }),
    });
    mockAssignmentModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439088',
        providerType: ProviderType.AIRLINE,
        airline: airlineId,
        hotel: null,
        assignedBy: adminId,
        isActive: true,
      }),
    });

    const result = await service.getMyProfile({
      userId: modId,
      email: 'mod@airline.com',
      role: Role.AIRLINE_MODERATOR,
      jti: 'jti-mod',
    });

    expect(mockAssignmentModel.findOne).toHaveBeenCalledWith({
      moderator: modId,
      isActive: true,
    });
    expect(result.moderatorAssignment).toEqual({
      id: '507f1f77bcf86cd799439088',
      providerType: ProviderType.AIRLINE,
      providerId: airlineId,
      airlineId,
      assignedBy: adminId,
      isActive: true,
    });
  });

  it('sets moderatorAssignment to null when moderator has no active assignment', async () => {
    const modId = '507f1f77bcf86cd799439033';
    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: modId,
          email: 'hotel-mod@example.com',
          firstName: 'Hotel',
          lastName: 'Mod',
          preferredCurrency: 'USD',
          role: Role.HOTEL_MODERATOR,
          status: AccountStatus.ACTIVE,
          isEmailVerified: true,
        }),
      }),
    });
    mockAssignmentModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    const result = await service.getMyProfile({
      userId: modId,
      email: 'hotel-mod@example.com',
      role: Role.HOTEL_MODERATOR,
      jti: 'jti-hm',
    });

    expect(result.moderatorAssignment).toBeNull();
  });

  it('throws UnauthorizedException for invalid userId, NotFoundException when missing, and ForbiddenException when inactive', async () => {
    await expect(
      service.getMyProfile({
        userId: 'bad-id',
        email: 'a@b.com',
        role: Role.REGISTERED_USER,
        jti: 'jti',
      }),
    ).rejects.toThrow(UnauthorizedException);

    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    await expect(
      service.getMyProfile({
        userId: '507f1f77bcf86cd799439011',
        email: 'missing@example.com',
        role: Role.REGISTERED_USER,
        jti: 'jti',
      }),
    ).rejects.toThrow(NotFoundException);

    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: '507f1f77bcf86cd799439011',
          status: AccountStatus.SUSPENDED,
        }),
      }),
    });
    await expect(
      service.getMyProfile({
        userId: '507f1f77bcf86cd799439011',
        email: 'suspended@example.com',
        role: Role.REGISTERED_USER,
        jti: 'jti',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('UsersService (ACC-09 updateMyProfile)', () => {
  let service: UsersService;

  const mockUserModel = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };

  const mockAssignmentModel = {
    findOne: jest.fn(),
  };

  const mockReferenceDataService = {
    isCurrencySupported: jest.fn(),
  };

  const userId = '507f1f77bcf86cd799439011';
  const authUser = {
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
          useValue: mockAssignmentModel,
        },
        {
          provide: ReferenceDataService,
          useValue: mockReferenceDataService,
        },
        {
          provide: getModelToken(UserSession.name),
          useValue: { updateMany: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('updates allowed profile fields and validates preferredCurrency against ReferenceDataService', async () => {
    const existingDoc = {
      _id: userId,
      email: 'traveler@example.com',
      firstName: 'Old',
      lastName: 'Name',
      preferredCurrency: 'USD',
      role: Role.REGISTERED_USER,
      status: AccountStatus.ACTIVE,
      isEmailVerified: true,
    };
    const updatedDoc = {
      ...existingDoc,
      firstName: 'Abdelaziz',
      lastName: 'Mohamed',
      phone: '+201001234567',
      avatarUrl: '/uploads/avatars/me.png',
      bio: 'Explorer',
      nationality: 'EG',
      preferredCurrency: 'EGP',
    };

    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(existingDoc),
      }),
    });
    mockReferenceDataService.isCurrencySupported.mockResolvedValue(true);
    mockUserModel.findByIdAndUpdate.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(updatedDoc),
      }),
    });

    const result = await service.updateMyProfile(authUser, {
      firstName: '  Abdelaziz ',
      lastName: ' Mohamed ',
      phone: ' +201001234567 ',
      avatarUrl: '/uploads/avatars/me.png',
      bio: ' Explorer ',
      nationality: ' eg ',
      preferredCurrency: ' egp ',
    });

    expect(mockReferenceDataService.isCurrencySupported).toHaveBeenCalledWith(
      'EGP',
    );
    expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
      userId,
      {
        $set: {
          firstName: 'Abdelaziz',
          lastName: 'Mohamed',
          phone: '+201001234567',
          avatarUrl: '/uploads/avatars/me.png',
          bio: 'Explorer',
          nationality: 'EG',
          preferredCurrency: 'EGP',
        },
      },
      { returnDocument: 'after' },
    );
    expect(result).toEqual({
      id: userId,
      email: 'traveler@example.com',
      firstName: 'Abdelaziz',
      lastName: 'Mohamed',
      phone: '+201001234567',
      avatarUrl: '/uploads/avatars/me.png',
      bio: 'Explorer',
      nationality: 'EG',
      preferredCurrency: 'EGP',
      role: Role.REGISTERED_USER,
      status: AccountStatus.ACTIVE,
      isEmailVerified: true,
      mustChangePassword: false,
    });
  });

  it('unsets optional fields when empty strings are submitted', async () => {
    const existingDoc = {
      _id: userId,
      email: 'traveler@example.com',
      firstName: 'Abdelaziz',
      lastName: 'Mohamed',
      phone: '+20100',
      bio: 'Old bio',
      preferredCurrency: 'USD',
      role: Role.REGISTERED_USER,
      status: AccountStatus.ACTIVE,
      isEmailVerified: true,
    };
    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(existingDoc),
      }),
    });
    mockUserModel.findByIdAndUpdate.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: userId,
          email: 'traveler@example.com',
          firstName: 'Abdelaziz',
          lastName: 'Mohamed',
          preferredCurrency: 'USD',
          role: Role.REGISTERED_USER,
          status: AccountStatus.ACTIVE,
          isEmailVerified: true,
        }),
      }),
    });

    await service.updateMyProfile(authUser, {
      phone: '   ',
      bio: '',
      avatarUrl: '',
      nationality: '',
    });

    expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
      userId,
      {
        $unset: {
          phone: 1,
          avatarUrl: 1,
          bio: 1,
          nationality: 1,
        },
      },
      { returnDocument: 'after' },
    );
  });

  it('throws BadRequestException when preferredCurrency is not supported', async () => {
    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: userId,
          status: AccountStatus.ACTIVE,
        }),
      }),
    });
    mockReferenceDataService.isCurrencySupported.mockResolvedValue(false);

    await expect(
      service.updateMyProfile(authUser, { preferredCurrency: 'ZZZ' }),
    ).rejects.toThrow(BadRequestException);
    expect(mockUserModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when role or status is passed directly and handles invalid/missing/inactive users', async () => {
    await expect(
      service.updateMyProfile(authUser, {
        role: Role.ADMIN,
      } as unknown as Record<string, string>),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      service.updateMyProfile(
        { ...authUser, userId: 'bad-id' },
        { firstName: 'Test' },
      ),
    ).rejects.toThrow(UnauthorizedException);

    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    await expect(
      service.updateMyProfile(authUser, { firstName: 'Test' }),
    ).rejects.toThrow(NotFoundException);

    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: userId,
          status: AccountStatus.SUSPENDED,
        }),
      }),
    });
    await expect(
      service.updateMyProfile(authUser, { firstName: 'Test' }),
    ).rejects.toThrow(ForbiddenException);
  });
});

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
          provide: ReferenceDataService,
          useValue: { isCurrencySupported: jest.fn() },
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
