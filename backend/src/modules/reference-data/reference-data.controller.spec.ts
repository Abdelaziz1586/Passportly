import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AllExceptionsFilter } from '../../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ListCitiesQueryDto } from './dto/list-cities-query.dto';
import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataService } from './reference-data.service';
import { Airport } from './schemas/airport.schema';
import { Attraction } from './schemas/attraction.schema';
import { City } from './schemas/city.schema';
import { Country } from './schemas/country.schema';

describe('ReferenceDataController (REF-02 GET /api/cities)', () => {
  let controller: ReferenceDataController;
  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockReferenceDataService = {
    getCities: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReferenceDataController],
      providers: [
        { provide: ReferenceDataService, useValue: mockReferenceDataService },
      ],
    }).compile();

    controller = module.get<ReferenceDataController>(ReferenceDataController);
  });

  it('marks ReferenceDataController as @Public()', () => {
    const reflector = new Reflector();
    expect(reflector.get<boolean>(IS_PUBLIC_KEY, ReferenceDataController)).toBe(
      true,
    );
  });

  it('transforms ListCitiesQueryDto and rejects unknown query params', async () => {
    const dto = (await validationPipe.transform(
      { countryCode: ' eg ', search: ' Cairo ', page: '1', limit: '5' },
      { type: 'query', metatype: ListCitiesQueryDto },
    )) as ListCitiesQueryDto;

    expect(dto.countryCode).toBe('EG');
    expect(dto.search).toBe('Cairo');

    mockReferenceDataService.getCities.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 5,
      totalPages: 0,
    });

    await controller.getCities(dto);
    expect(mockReferenceDataService.getCities).toHaveBeenCalledWith(dto);

    await expect(
      validationPipe.transform(
        { invalidParam: '123' },
        { type: 'query', metatype: ListCitiesQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  describe('HTTP integration (REF-02 GET /api/cities)', () => {
    it('serves city records publicly with countryCode and search filtering and pagination', async () => {
      const cities = [
        {
          _id: '507f1f77bcf86cd799439021',
          externalId: 'cairo',
          name: 'Cairo',
          country: '507f1f77bcf86cd799439011',
          countryCode: 'EG',
        },
        {
          _id: '507f1f77bcf86cd799439022',
          externalId: 'dubai',
          name: 'Dubai',
          country: '507f1f77bcf86cd799439012',
          countryCode: 'AE',
        },
      ];

      const filterRows = (filter: Record<string, unknown>) =>
        cities.filter((c) => {
          if (filter.countryCode && c.countryCode !== filter.countryCode) {
            return false;
          }
          if (Array.isArray(filter.$and)) {
            return filter.$and.every((cond: Record<string, unknown>) => {
              if (cond.countryCode && c.countryCode !== cond.countryCode) {
                return false;
              }
              if (Array.isArray(cond.$or)) {
                return cond.$or.some((branch: Record<string, RegExp>) => {
                  const [key, regex] = Object.entries(branch)[0];
                  const val = c[key as keyof typeof c];
                  return typeof val === 'string' && regex.test(val);
                });
              }
              return true;
            });
          }
          return true;
        });

      const fakeCityModel = {
        find: jest.fn((filter: Record<string, unknown>) => {
          const matched = filterRows(filter);
          return {
            sort: jest.fn().mockReturnValue({
              skip: jest.fn((skipCount: number) => ({
                limit: jest.fn((limitCount: number) => ({
                  lean: jest
                    .fn()
                    .mockResolvedValue(
                      matched.slice(skipCount, skipCount + limitCount),
                    ),
                })),
              })),
            }),
          };
        }),
        countDocuments: jest.fn((filter: Record<string, unknown>) =>
          Promise.resolve(filterRows(filter).length),
        ),
      };

      const moduleRef = await Test.createTestingModule({
        controllers: [ReferenceDataController],
        providers: [
          ReferenceDataService,
          { provide: getModelToken(Country.name), useValue: {} },
          { provide: getModelToken(City.name), useValue: fakeCityModel },
          { provide: getModelToken(Airport.name), useValue: {} },
          { provide: getModelToken(Attraction.name), useValue: {} },
          { provide: APP_GUARD, useClass: JwtAuthGuard },
          { provide: APP_GUARD, useClass: RolesGuard },
        ],
      }).compile();

      const app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
      );
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      try {
        const res = await request(app.getHttpServer() as App)
          .get('/api/cities?countryCode=eg&search=cai&page=1&limit=10')
          .expect(200);

        expect(res.body).toEqual({
          data: [
            {
              id: '507f1f77bcf86cd799439021',
              externalId: 'cairo',
              name: 'Cairo',
              countryId: '507f1f77bcf86cd799439011',
              countryCode: 'EG',
            },
          ],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        });

        await request(app.getHttpServer() as App)
          .get('/api/cities?unknown=1')
          .expect(400);
      } finally {
        await app.close();
      }
    });
  });
});
