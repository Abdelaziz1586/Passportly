import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AccountStatus, Role } from '../../common/enums';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';

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
