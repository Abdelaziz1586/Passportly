import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { ReportStatus, Role } from '../../common/enums';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ResolveReportDto } from './dto/resolve-report.dto';

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
