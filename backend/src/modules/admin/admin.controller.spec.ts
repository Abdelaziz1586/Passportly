import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { ReportStatus, ReportTargetType, Role } from '../../common/enums';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';

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
