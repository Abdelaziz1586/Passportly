import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AllExceptionsFilter } from '../../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ListAttractionsQueryDto } from './dto/list-attractions-query.dto';
import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataService } from './reference-data.service';
import { Airport } from './schemas/airport.schema';
import { Attraction } from './schemas/attraction.schema';
import { City } from './schemas/city.schema';
import { Country } from './schemas/country.schema';

describe('ReferenceDataController (REF-03 GET /api/attractions)', () => {
  let controller: ReferenceDataController;
  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockReferenceDataService = {
    getAttractions: jest.fn(),
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

  it('transforms ListAttractionsQueryDto and rejects unknown query params', async () => {
    const dto = (await validationPipe.transform(
      {
        cityId: ' cairo ',
        countryCode: ' eg ',
        category: ' Historical ',
        search: ' Pyramids ',
        page: '1',
        limit: '10',
      },
      { type: 'query', metatype: ListAttractionsQueryDto },
    )) as ListAttractionsQueryDto;

    expect(dto.cityId).toBe('cairo');
    expect(dto.countryCode).toBe('EG');
    expect(dto.category).toBe('Historical');
    expect(dto.search).toBe('Pyramids');

    mockReferenceDataService.getAttractions.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 10,
      totalPages: 0,
    });

    await controller.getAttractions(dto);
    expect(mockReferenceDataService.getAttractions).toHaveBeenCalledWith(dto);

    await expect(
      validationPipe.transform(
        { unknownFilter: 'x' },
        { type: 'query', metatype: ListAttractionsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  describe('HTTP integration (REF-03 GET /api/attractions)', () => {
    it('serves attractions publicly with countryCode and cityId filtering and pagination', async () => {
      const cairoCityId = new Types.ObjectId('507f1f77bcf86cd799439021');
      const londonCityId = new Types.ObjectId('507f1f77bcf86cd799439022');
      const egCountryId = new Types.ObjectId('507f1f77bcf86cd799439011');
      const gbCountryId = new Types.ObjectId('507f1f77bcf86cd799439012');

      const cities = [
        {
          _id: cairoCityId,
          externalId: 'cairo',
          name: 'Cairo',
          country: egCountryId,
          countryCode: 'EG',
        },
        {
          _id: londonCityId,
          externalId: 'london',
          name: 'London',
          country: gbCountryId,
          countryCode: 'GB',
        },
      ];

      const attractions = [
        {
          _id: '507f1f77bcf86cd799439051',
          externalId: 'att-1',
          name: 'Giza Pyramids and Sphinx',
          city: cities[0],
          cityName: 'Cairo',
        },
        {
          _id: '507f1f77bcf86cd799439052',
          externalId: 'att-3',
          name: 'British Museum',
          city: cities[1],
          cityName: 'London',
        },
      ];

      const fakeCityModel = {
        find: jest.fn((filter: Record<string, unknown>) => {
          const matched = cities.filter((c) => {
            if (filter.countryCode && c.countryCode !== filter.countryCode) {
              return false;
            }
            if (
              filter.externalId instanceof RegExp &&
              !filter.externalId.test(c.externalId)
            ) {
              return false;
            }
            return true;
          });
          return {
            select: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue(matched),
            }),
          };
        }),
      };

      const matchesCondition = (
        attr: (typeof attractions)[number],
        cond: Record<string, unknown>,
      ): boolean => {
        if (
          typeof cond.city === 'object' &&
          cond.city !== null &&
          '$in' in cond.city
        ) {
          const ids = (cond.city as { $in: Types.ObjectId[] }).$in.map(String);
          return ids.includes(String(attr.city._id));
        }
        if (Array.isArray(cond.$or)) {
          return cond.$or.some((branch: Record<string, unknown>) =>
            matchesCondition(attr, branch),
          );
        }
        if (cond.countryCode) {
          return attr.city.countryCode === cond.countryCode;
        }
        return false;
      };

      const filterRows = (filter: Record<string, unknown>) => {
        if (Object.keys(filter).length === 0) return attractions;
        if (Array.isArray(filter.$and)) {
          return attractions.filter((a) =>
            (filter.$and as Record<string, unknown>[]).every((c) =>
              matchesCondition(a, c),
            ),
          );
        }
        return attractions.filter((a) => matchesCondition(a, filter));
      };

      const fakeAttractionModel = {
        find: jest.fn((filter: Record<string, unknown>) => {
          const matched = filterRows(filter);
          return {
            populate: jest.fn().mockReturnValue({
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
          {
            provide: getModelToken(Attraction.name),
            useValue: fakeAttractionModel,
          },
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
          .get('/api/attractions?cityId=cairo&countryCode=eg&page=1&limit=10')
          .expect(200);

        expect(res.body).toEqual({
          data: [
            {
              id: '507f1f77bcf86cd799439051',
              externalId: 'att-1',
              name: 'Giza Pyramids and Sphinx',
              cityId: String(cairoCityId),
              cityName: 'Cairo',
              countryId: String(egCountryId),
              countryCode: 'EG',
            },
          ],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        });

        await request(app.getHttpServer() as App)
          .get('/api/attractions?limit=0')
          .expect(400);
      } finally {
        await app.close();
      }
    });
  });
});
