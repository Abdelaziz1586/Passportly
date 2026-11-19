import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { AccountStatus, Role } from '../../common/enums';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { User } from '../users/schemas/user.schema';
import { AuthService } from './auth.service';
import { UserSession } from './schemas/user-session.schema';

describe('AuthService (ACC-01 register)', () => {
  let service: AuthService;

  const mockUserModel = {
    exists: jest.fn(),
    create: jest.fn(),
  };

  const mockSessionModel = {};
  const mockJwtService = {};
  const mockConfigService = {};
  const mockReferenceDataService = {
    isCurrencySupported: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
        {
          provide: getModelToken(UserSession.name),
          useValue: mockSessionModel,
        },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: ReferenceDataService,
          useValue: mockReferenceDataService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('registers a new user with hashed password, REGISTERED_USER role, and safe profile response', async () => {
    mockUserModel.exists.mockResolvedValue(null);
    mockReferenceDataService.isCurrencySupported.mockResolvedValue(true);

    const now = new Date('2026-11-19T10:00:00.000Z');
    mockUserModel.create.mockImplementation((doc: Record<string, unknown>) =>
      Promise.resolve({
        _id: '507f1f77bcf86cd799439011',
        ...doc,
        emailVerificationToken: 'secret-verify-token',
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
    expect(typeof createArg.passwordHash).toBe('string');
    expect(createArg.passwordHash).not.toBe('StrongPassword123!');
    await expect(
      bcrypt.compare('StrongPassword123!', String(createArg.passwordHash)),
    ).resolves.toBe(true);

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

    expect(mockReferenceDataService.isCurrencySupported).not.toHaveBeenCalled();
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
