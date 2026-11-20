import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AccountStatus, Role } from '../../common/enums';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';

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
