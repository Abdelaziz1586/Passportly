import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { BookingStatus, BookingType, Role } from '../../common/enums';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ListAdminBookingsQueryDto } from './dto/list-admin-bookings-query.dto';

describe('AdminController (ACC-17 admin bookings)', () => {
  let controller: AdminController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockAdminService = {
    listPlatformBookings: jest.fn(),
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

  it('parses YYYY-MM-DD date boundaries accurately and delegates to service', async () => {
    const query = (await validationPipe.transform(
      {
        bookingType: BookingType.HOTEL,
        status: BookingStatus.CONFIRMED,
        userId: '507f1f77bcf86cd799439011',
        fromDate: '2026-11-01',
        toDate: '2026-11-19',
        page: '1',
        limit: '10',
      },
      { type: 'query', metatype: ListAdminBookingsQueryDto },
    )) as ListAdminBookingsQueryDto;

    expect(query.fromDate?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(query.toDate?.toISOString()).toBe('2026-11-19T23:59:59.999Z');

    const expected = { data: [], total: 0, page: 1, limit: 10, totalPages: 0 };
    mockAdminService.listPlatformBookings.mockResolvedValue(expected);

    const result = await controller.listPlatformBookings(query);
    expect(result).toEqual(expected);
  });

  it('rejects invalid userId and unknown query fields', async () => {
    await expect(
      validationPipe.transform(
        { userId: 'not-valid' },
        { type: 'query', metatype: ListAdminBookingsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      validationPipe.transform(
        { unknownParam: 'x' },
        { type: 'query', metatype: ListAdminBookingsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
