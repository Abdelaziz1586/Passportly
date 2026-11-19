import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

describe('AdminController (GEN-07 audit logs)', () => {
  let controller: AdminController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockAdminService = {
    listAuditLogs: jest.fn(),
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

  it('validates query filters and YYYY-MM-DD date range and delegates to service', async () => {
    const query = (await validationPipe.transform(
      {
        actor: '507f1f77bcf86cd799439001',
        action: '  ACCOUNT_SUSPENDED  ',
        targetType: 'User',
        fromDate: '2026-11-01',
        toDate: '2026-11-19',
        page: '1',
        limit: '25',
      },
      { type: 'query', metatype: ListAuditLogsQueryDto },
    )) as ListAuditLogsQueryDto;

    expect(query.action).toBe('ACCOUNT_SUSPENDED');
    expect(query.fromDate?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(query.toDate?.toISOString()).toBe('2026-11-19T23:59:59.999Z');

    const expected = { data: [], total: 0, page: 1, limit: 25, totalPages: 0 };
    mockAdminService.listAuditLogs.mockResolvedValue(expected);

    const result = await controller.listAuditLogs(query);
    expect(result).toEqual(expected);
  });

  it('rejects invalid actor ObjectId and disallowed sortBy field', async () => {
    await expect(
      validationPipe.transform(
        { actor: 'not-an-id' },
        { type: 'query', metatype: ListAuditLogsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      validationPipe.transform(
        { sortBy: 'ipAddress' },
        { type: 'query', metatype: ListAuditLogsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
