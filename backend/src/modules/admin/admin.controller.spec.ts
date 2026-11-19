import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AccountStatus, Role } from '../../common/enums';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SuspendAccountDto } from './dto/suspend-account.dto';

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
