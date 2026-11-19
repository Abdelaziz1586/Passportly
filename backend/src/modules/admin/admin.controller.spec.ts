import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

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
