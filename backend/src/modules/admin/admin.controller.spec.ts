import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AccountStatus, Role } from '../../common/enums';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

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
