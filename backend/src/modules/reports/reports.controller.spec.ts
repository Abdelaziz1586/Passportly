import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ReportStatus, ReportTargetType, Role } from '../../common/enums';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

describe('ReportsController (GEN-09 create report)', () => {
  let controller: ReportsController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  });

  const mockReportsService = {
    createReport: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [{ provide: ReportsService, useValue: mockReportsService }],
    }).compile();

    controller = module.get<ReportsController>(ReportsController);
  });

  it('requires authentication (not @Public())', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      ReportsController.prototype,
      'createReport',
    )?.value as (...args: never[]) => unknown;
    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBeUndefined();
  });

  it('validates DTO and delegates report creation to ReportsService', async () => {
    const dto = (await validationPipe.transform(
      {
        targetType: ReportTargetType.BLOG_POST,
        targetId: '507f1f77bcf86cd799439022',
        reason: '  Spam content  ',
      },
      { type: 'body', metatype: CreateReportDto },
    )) as CreateReportDto;

    expect(dto.reason).toBe('Spam content');

    const expected = {
      id: '507f1f77bcf86cd799439033',
      reporter: '507f1f77bcf86cd799439011',
      targetType: ReportTargetType.BLOG_POST,
      targetId: '507f1f77bcf86cd799439022',
      reason: 'Spam content',
      status: ReportStatus.PENDING,
    };
    mockReportsService.createReport.mockResolvedValue(expected);

    const user = {
      userId: '507f1f77bcf86cd799439011',
      email: 'user@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    };
    const result = await controller.createReport(user, dto);

    expect(result).toEqual(expected);
    expect(mockReportsService.createReport).toHaveBeenCalledWith(user, dto);
  });

  it('rejects invalid targetType and non-whitelisted status injection', async () => {
    await expect(
      validationPipe.transform(
        {
          targetType: 'INVALID_TYPE',
          targetId: '507f1f77bcf86cd799439022',
          reason: 'Spam',
        },
        { type: 'body', metatype: CreateReportDto },
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      validationPipe.transform(
        {
          targetType: ReportTargetType.BLOG_POST,
          targetId: '507f1f77bcf86cd799439022',
          reason: 'Spam',
          status: ReportStatus.DISMISSED,
        },
        { type: 'body', metatype: CreateReportDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
