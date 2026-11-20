import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import {
  AccountStatus,
  BookingStatus,
  BookingType,
  ProviderType,
  ReportStatus,
  ReportTargetType,
  Role,
} from '../../common/enums';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';
import { SuspendAccountDto } from './dto/suspend-account.dto';
import { ListAdminBookingsQueryDto } from './dto/list-admin-bookings-query.dto';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';

describe('AdminController (ACC-07a admin reset password)', () => {
  let controller: AdminController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockAdminService = {
    resetUserPassword: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: mockAdminService }],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it('restricts AdminController to Role.ADMIN', () => {
    const reflector = new Reflector();
    const roles = reflector.get<Role[]>(ROLES_KEY, AdminController);
    expect(roles).toEqual([Role.ADMIN]);
  });

  it('validates temporaryPassword and delegates to AdminService.resetUserPassword', async () => {
    const dto = (await validationPipe.transform(
      { temporaryPassword: 'TempPassword123!' },
      { type: 'body', metatype: AdminResetPasswordDto },
    )) as AdminResetPasswordDto;

    const expected = {
      message: 'Temporary password set successfully',
      userId: '507f1f77bcf86cd799439022',
      mustChangePassword: true,
      sessionsRevoked: 1,
    };
    mockAdminService.resetUserPassword.mockResolvedValue(expected);

    const admin = {
      userId: '507f1f77bcf86cd799439001',
      email: 'admin@example.com',
      role: Role.ADMIN,
      jti: 'jti-1',
    };
    const req = { ip: '127.0.0.1' } as unknown as Request;

    const result = await controller.resetUserPassword(
      '507f1f77bcf86cd799439022',
      dto,
      admin,
      req,
    );

    expect(result).toEqual(expected);
    expect(mockAdminService.resetUserPassword).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439022',
      dto,
      admin,
      '127.0.0.1',
    );
  });

  it('rejects weak temporaryPassword via ValidationPipe', async () => {
    await expect(
      validationPipe.transform(
        { temporaryPassword: 'weak' },
        { type: 'body', metatype: AdminResetPasswordDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('AdminController (ACC-13 create moderator)', () => {
  let controller: AdminController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockAdminService = {
    createModerator: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: mockAdminService }],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it('restricts endpoint to Role.ADMIN', () => {
    const reflector = new Reflector();
    expect(reflector.get<Role[]>(ROLES_KEY, AdminController)).toEqual([
      Role.ADMIN,
    ]);
  });

  it('validates CreateModeratorDto and rejects ADMIN or REGISTERED_USER role values', async () => {
    await expect(
      validationPipe.transform(
        {
          email: 'mod@example.com',
          password: 'StrongPassword123!',
          firstName: 'Mod',
          lastName: 'User',
          role: Role.ADMIN,
          providerId: '507f1f77bcf86cd799439055',
        },
        { type: 'body', metatype: CreateModeratorDto },
      ),
    ).rejects.toThrow(BadRequestException);

    const validDto = (await validationPipe.transform(
      {
        email: '  Mod@Example.COM ',
        password: 'StrongPassword123!',
        firstName: '  Mod ',
        lastName: ' User ',
        role: Role.HOTEL_MODERATOR,
        providerId: '507f1f77bcf86cd799439055',
      },
      { type: 'body', metatype: CreateModeratorDto },
    )) as CreateModeratorDto;

    expect(validDto.email).toBe('mod@example.com');
    const expected = { id: '123', email: 'mod@example.com' };
    mockAdminService.createModerator.mockResolvedValue(expected);

    const admin = {
      userId: '507f1f77bcf86cd799439001',
      email: 'admin@example.com',
      role: Role.ADMIN,
      jti: 'jti-1',
    };
    const req = { ip: '127.0.0.1' } as unknown as Request;

    const result = await controller.createModerator(validDto, admin, req);
    expect(result).toEqual(expected);
  });
});

describe('AdminController (ACC-14 list accounts)', () => {
  let controller: AdminController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockAdminService = {
    listAccounts: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: mockAdminService }],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it('restricts endpoint to Role.ADMIN', () => {
    const reflector = new Reflector();
    expect(reflector.get<Role[]>(ROLES_KEY, AdminController)).toEqual([
      Role.ADMIN,
    ]);
  });

  it('validates query params and delegates to AdminService.listAccounts', async () => {
    const query = (await validationPipe.transform(
      {
        role: Role.REGISTERED_USER,
        status: AccountStatus.ACTIVE,
        search: '  youssef  ',
        page: '2',
        limit: '15',
      },
      { type: 'query', metatype: ListAccountsQueryDto },
    )) as ListAccountsQueryDto;

    expect(query.search).toBe('youssef');
    const expected = { data: [], total: 0, page: 2, limit: 15, totalPages: 0 };
    mockAdminService.listAccounts.mockResolvedValue(expected);

    const result = await controller.listAccounts(query);
    expect(result).toEqual(expected);
    expect(mockAdminService.listAccounts).toHaveBeenCalledWith(query);
  });

  it('rejects unsupported sortBy field via ValidationPipe', async () => {
    await expect(
      validationPipe.transform(
        { sortBy: 'passwordHash' },
        { type: 'query', metatype: ListAccountsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('AdminController (ACC-15/ACC-16 suspend account)', () => {
  let controller: AdminController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockAdminService = {
    suspendAccount: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: mockAdminService }],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it('restricts endpoint to Role.ADMIN', () => {
    const reflector = new Reflector();
    expect(reflector.get<Role[]>(ROLES_KEY, AdminController)).toEqual([
      Role.ADMIN,
    ]);
  });

  it('validates SuspendAccountDto and delegates to AdminService.suspendAccount', async () => {
    const dto = (await validationPipe.transform(
      { reason: '  Abusive behavior  ' },
      { type: 'body', metatype: SuspendAccountDto },
    )) as SuspendAccountDto;

    expect(dto.reason).toBe('Abusive behavior');

    const expected = {
      message: 'Account suspended successfully',
      id: '507f1f77bcf86cd799439022',
      email: 'user@example.com',
      role: Role.REGISTERED_USER,
      status: AccountStatus.SUSPENDED,
      sessionsRevoked: 1,
    };
    mockAdminService.suspendAccount.mockResolvedValue(expected);

    const admin = {
      userId: '507f1f77bcf86cd799439001',
      email: 'admin@example.com',
      role: Role.ADMIN,
      jti: 'jti-1',
    };
    const req = { ip: '127.0.0.1' } as unknown as Request;

    const result = await controller.suspendAccount(
      '507f1f77bcf86cd799439022',
      dto,
      admin,
      req,
    );
    expect(result).toEqual(expected);
  });

  it('rejects whitespace-only reason via ValidationPipe', async () => {
    await expect(
      validationPipe.transform(
        { reason: '   ' },
        { type: 'body', metatype: SuspendAccountDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('AdminController (ACC-15/ACC-16 reactivate account)', () => {
  let controller: AdminController;

  const mockAdminService = {
    reactivateAccount: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: mockAdminService }],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it('restricts endpoint to Role.ADMIN', () => {
    const reflector = new Reflector();
    expect(reflector.get<Role[]>(ROLES_KEY, AdminController)).toEqual([
      Role.ADMIN,
    ]);
  });

  it('delegates reactivateAccount to AdminService', async () => {
    const expected = {
      message: 'Account reactivated successfully',
      id: '507f1f77bcf86cd799439022',
      email: 'user@example.com',
      role: Role.REGISTERED_USER,
      status: AccountStatus.ACTIVE,
      failedLoginAttempts: 0,
    };
    mockAdminService.reactivateAccount.mockResolvedValue(expected);

    const admin = {
      userId: '507f1f77bcf86cd799439001',
      email: 'admin@example.com',
      role: Role.ADMIN,
      jti: 'jti-1',
    };
    const req = { ip: '127.0.0.1' } as unknown as Request;

    const result = await controller.reactivateAccount(
      '507f1f77bcf86cd799439022',
      admin,
      req,
    );
    expect(result).toEqual(expected);
    expect(mockAdminService.reactivateAccount).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439022',
      admin,
      '127.0.0.1',
    );
  });
});

describe('AdminController (ACC-15 deactivate provider)', () => {
  let controller: AdminController;

  const mockAdminService = {
    deactivateProvider: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: mockAdminService }],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it('restricts endpoint to Role.ADMIN', () => {
    const reflector = new Reflector();
    expect(reflector.get<Role[]>(ROLES_KEY, AdminController)).toEqual([
      Role.ADMIN,
    ]);
  });

  it('delegates deactivateProvider to AdminService', async () => {
    const expected = {
      message: 'Airline deactivated successfully',
      id: '507f1f77bcf86cd799439022',
      type: ProviderType.AIRLINE,
      name: 'EgyptAir',
      isActive: false,
      deactivatedAt: new Date('2026-11-19T14:00:00.000Z'),
      moderatorsNotified: 1,
      travelersNotified: 2,
    };
    mockAdminService.deactivateProvider.mockResolvedValue(expected);

    const admin = {
      userId: '507f1f77bcf86cd799439001',
      email: 'admin@example.com',
      role: Role.ADMIN,
      jti: 'jti-1',
    };
    const req = { ip: '127.0.0.1' } as unknown as Request;

    const result = await controller.deactivateProvider(
      'airline',
      '507f1f77bcf86cd799439022',
      admin,
      req,
    );
    expect(result).toEqual(expected);
    expect(mockAdminService.deactivateProvider).toHaveBeenCalledWith(
      'airline',
      '507f1f77bcf86cd799439022',
      admin,
      '127.0.0.1',
    );
  });
});

describe('AdminController (ACC-15 reactivate provider)', () => {
  let controller: AdminController;

  const mockAdminService = {
    reactivateProvider: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: mockAdminService }],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it('restricts endpoint to Role.ADMIN', () => {
    const reflector = new Reflector();
    expect(reflector.get<Role[]>(ROLES_KEY, AdminController)).toEqual([
      Role.ADMIN,
    ]);
  });

  it('delegates reactivateProvider to AdminService', async () => {
    const expected = {
      message: 'Airline reactivated successfully',
      id: '507f1f77bcf86cd799439022',
      type: ProviderType.AIRLINE,
      name: 'EgyptAir',
      isActive: true,
      moderatorsNotified: 1,
    };
    mockAdminService.reactivateProvider.mockResolvedValue(expected);

    const admin = {
      userId: '507f1f77bcf86cd799439001',
      email: 'admin@example.com',
      role: Role.ADMIN,
      jti: 'jti-1',
    };
    const req = { ip: '127.0.0.1' } as unknown as Request;

    const result = await controller.reactivateProvider(
      'airline',
      '507f1f77bcf86cd799439022',
      admin,
      req,
    );
    expect(result).toEqual(expected);
  });
});

describe('AdminController (ACC-17 admin bookings)', () => {
  let controller: AdminController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockAdminService = {
    listPlatformBookings: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: mockAdminService }],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it('restricts endpoint to Role.ADMIN', () => {
    const reflector = new Reflector();
    expect(reflector.get<Role[]>(ROLES_KEY, AdminController)).toEqual([
      Role.ADMIN,
    ]);
  });

  it('parses YYYY-MM-DD date boundaries accurately and delegates to service', async () => {
    const query = (await validationPipe.transform(
      {
        bookingType: BookingType.HOTEL,
        status: BookingStatus.CONFIRMED,
        userId: '507f1f77bcf86cd799439011',
        fromDate: '2026-11-01',
        toDate: '2026-11-19',
        page: '1',
        limit: '10',
      },
      { type: 'query', metatype: ListAdminBookingsQueryDto },
    )) as ListAdminBookingsQueryDto;

    expect(query.fromDate?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(query.toDate?.toISOString()).toBe('2026-11-19T23:59:59.999Z');

    const expected = { data: [], total: 0, page: 1, limit: 10, totalPages: 0 };
    mockAdminService.listPlatformBookings.mockResolvedValue(expected);

    const result = await controller.listPlatformBookings(query);
    expect(result).toEqual(expected);
  });

  it('rejects invalid userId and unknown query fields', async () => {
    await expect(
      validationPipe.transform(
        { userId: 'not-valid' },
        { type: 'query', metatype: ListAdminBookingsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      validationPipe.transform(
        { unknownParam: 'x' },
        { type: 'query', metatype: ListAdminBookingsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('AdminController (GEN-09/GEN-10 list reports)', () => {
  let controller: AdminController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockAdminService = {
    listReports: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: mockAdminService }],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it('restricts endpoint to Role.ADMIN', () => {
    const reflector = new Reflector();
    expect(reflector.get<Role[]>(ROLES_KEY, AdminController)).toEqual([
      Role.ADMIN,
    ]);
  });

  it('validates status and targetType filters and delegates to AdminService.listReports', async () => {
    const query = (await validationPipe.transform(
      {
        status: ReportStatus.PENDING,
        targetType: ReportTargetType.REVIEW,
        page: '1',
        limit: '10',
      },
      { type: 'query', metatype: ListReportsQueryDto },
    )) as ListReportsQueryDto;

    const expected = { data: [], total: 0, page: 1, limit: 10, totalPages: 0 };
    mockAdminService.listReports.mockResolvedValue(expected);

    const result = await controller.listReports(query);
    expect(result).toEqual(expected);
  });

  it('rejects invalid ReportStatus values via ValidationPipe', async () => {
    await expect(
      validationPipe.transform(
        { status: 'UNKNOWN' },
        { type: 'query', metatype: ListReportsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('AdminController (GEN-10 resolve report)', () => {
  let controller: AdminController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockAdminService = {
    resolveReport: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: mockAdminService }],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it('restricts endpoint to Role.ADMIN', () => {
    const reflector = new Reflector();
    expect(reflector.get<Role[]>(ROLES_KEY, AdminController)).toEqual([
      Role.ADMIN,
    ]);
  });

  it('rejects setting status back to PENDING and delegates valid resolutions', async () => {
    await expect(
      validationPipe.transform(
        { status: ReportStatus.PENDING },
        { type: 'body', metatype: ResolveReportDto },
      ),
    ).rejects.toThrow(BadRequestException);

    const dto = (await validationPipe.transform(
      {
        status: ReportStatus.CONTENT_HIDDEN,
        resolutionNotes: '  Violated guidelines  ',
      },
      { type: 'body', metatype: ResolveReportDto },
    )) as ResolveReportDto;

    expect(dto.resolutionNotes).toBe('Violated guidelines');

    const expected = { id: '123', status: ReportStatus.CONTENT_HIDDEN };
    mockAdminService.resolveReport.mockResolvedValue(expected);

    const admin = {
      userId: '507f1f77bcf86cd799439001',
      email: 'admin@example.com',
      role: Role.ADMIN,
      jti: 'jti-1',
    };
    const req = { ip: '127.0.0.1' } as unknown as Request;

    const result = await controller.resolveReport('123', dto, admin, req);
    expect(result).toEqual(expected);
  });
});

describe('AdminController (GEN-10 delete content)', () => {
  let controller: AdminController;

  const mockAdminService = {
    deleteContent: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: mockAdminService }],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it('restricts endpoint to Role.ADMIN', () => {
    const reflector = new Reflector();
    expect(reflector.get<Role[]>(ROLES_KEY, AdminController)).toEqual([
      Role.ADMIN,
    ]);
  });

  it('delegates deleteContent to AdminService', async () => {
    const expected = {
      message: 'BlogPost deleted successfully',
      type: 'blog_post',
      id: '507f1f77bcf86cd799439022',
      ownerId: '507f1f77bcf86cd799439011',
      resolvedPendingReports: 0,
    };
    mockAdminService.deleteContent.mockResolvedValue(expected);

    const admin = {
      userId: '507f1f77bcf86cd799439001',
      email: 'admin@example.com',
      role: Role.ADMIN,
      jti: 'jti-1',
    };
    const req = { ip: '127.0.0.1' } as unknown as Request;

    const result = await controller.deleteContent(
      'blog_post',
      '507f1f77bcf86cd799439022',
      admin,
      req,
    );
    expect(result).toEqual(expected);
  });
});
