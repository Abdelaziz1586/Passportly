import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountStatus, ProviderType, Role } from '../../common/enums';
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
