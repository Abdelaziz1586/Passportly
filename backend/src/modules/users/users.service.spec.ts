import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountStatus, Role } from '../../common/enums';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { ModeratorAssignment } from './schemas/moderator-assignment.schema';
import { User } from './schemas/user.schema';
import { UsersService } from './users.service';

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
