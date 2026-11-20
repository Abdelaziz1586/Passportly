import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';

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
