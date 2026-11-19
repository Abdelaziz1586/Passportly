import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CreateModeratorDto } from './dto/create-moderator.dto';

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
