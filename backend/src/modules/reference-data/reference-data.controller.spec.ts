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
import { ListAirportsQueryDto } from './dto/list-airports-query.dto';
import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataService } from './reference-data.service';
import { Airport } from './schemas/airport.schema';
import { Attraction } from './schemas/attraction.schema';
import { City } from './schemas/city.schema';
import { Country } from './schemas/country.schema';
import { ListCountriesQueryDto } from './dto/list-countries-query.dto';

describe('ReferenceDataController (FLT-02 GET /api/airports)', () => {
  let controller: ReferenceDataController;
  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockReferenceDataService = {
    getAirports: jest.fn(),
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

  it('transforms and validates ListAirportsQueryDto and rejects unknown params', async () => {
    const dto = (await validationPipe.transform(
      { iataCode: ' cai ', countryCode: ' eg ', page: '2', limit: '10' },
      { type: 'query', metatype: ListAirportsQueryDto },
    )) as ListAirportsQueryDto;

    expect(dto.iataCode).toBe('CAI');
    expect(dto.countryCode).toBe('EG');
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(10);

    mockReferenceDataService.getAirports.mockResolvedValue({
      data: [],
      total: 0,
      page: 2,
      limit: 10,
      totalPages: 0,
    });

    await controller.getAirports(dto);
    expect(mockReferenceDataService.getAirports).toHaveBeenCalledWith(dto);

    await expect(
      validationPipe.transform(
        { unknownParam: 'x' },
        { type: 'query', metatype: ListAirportsQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  describe('HTTP integration (FLT-02 GET /api/airports)', () => {
    it('allows public access, filters by iataCode/countryCode/search, and returns paginated airports with IANA timezone', async () => {
      const airports = [
        {
          _id: '507f1f77bcf86cd799439011',
          iataCode: 'CAI',
          name: 'Cairo International Airport',
          cityName: 'Cairo',
          countryCode: 'EG',
          timezone: 'Africa/Cairo',
        },
        {
          _id: '507f1f77bcf86cd799439012',
          iataCode: 'DXB',
          name: 'Dubai International Airport',
          cityName: 'Dubai',
          countryCode: 'AE',
          timezone: 'Asia/Dubai',
        },
      ];

      const fakeAirportModel = {
        find: jest.fn((filter: Record<string, unknown>) => {
          const matched = airports.filter((a) => {
            if (filter.countryCode && a.countryCode !== filter.countryCode) {
              return false;
            }
            if (filter.iataCode && a.iataCode !== filter.iataCode) {
              return false;
            }
            return true;
          });
          return {
            sort: jest.fn().mockReturnValue({
              skip: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({
                  lean: jest.fn().mockResolvedValue(matched),
                }),
              }),
            }),
          };
        }),
        countDocuments: jest.fn((filter: Record<string, unknown>) => {
          const matched = airports.filter((a) => {
            if (filter.countryCode && a.countryCode !== filter.countryCode) {
              return false;
            }
            if (filter.iataCode && a.iataCode !== filter.iataCode) {
              return false;
            }
            return true;
          });
          return Promise.resolve(matched.length);
        }),
      };

      const moduleRef = await Test.createTestingModule({
        controllers: [ReferenceDataController],
        providers: [
          ReferenceDataService,
          { provide: getModelToken(Country.name), useValue: {} },
          {
            provide: getModelToken(City.name),
            useValue: {
              find: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnValue({
                  lean: jest.fn().mockResolvedValue([]),
                }),
              }),
            },
          },
          { provide: getModelToken(Airport.name), useValue: fakeAirportModel },
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
          .get('/api/airports?countryCode=eg&page=1&limit=10')
          .expect(200);

        expect(res.body).toEqual({
          data: [
            {
              id: '507f1f77bcf86cd799439011',
              iataCode: 'CAI',
              name: 'Cairo International Airport',
              cityName: 'Cairo',
              countryCode: 'EG',
              timezone: 'Africa/Cairo',
            },
          ],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        });

        await request(app.getHttpServer() as App)
          .get('/api/airports?limit=500')
          .expect(400);
      } finally {
        await app.close();
      }
    });
  });
});

describe('ReferenceDataController (REF-01 GET /api/countries)', () => {
  let controller: ReferenceDataController;
  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockReferenceDataService = {
    getCountries: jest.fn(),
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

  it('normalizes ListCountriesQueryDto and rejects unknown params', async () => {
    const dto = (await validationPipe.transform(
      { code: ' eg ', currencyCode: ' egp ', page: '1', limit: '5' },
      { type: 'query', metatype: ListCountriesQueryDto },
    )) as ListCountriesQueryDto;

    expect(dto.code).toBe('EG');
    expect(dto.currencyCode).toBe('EGP');

    mockReferenceDataService.getCountries.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 5,
      totalPages: 0,
    });

    await controller.getCountries(dto);
    expect(mockReferenceDataService.getCountries).toHaveBeenCalledWith(dto);

    await expect(
      validationPipe.transform(
        { extra: 'bad' },
        { type: 'query', metatype: ListCountriesQueryDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  describe('HTTP integration (REF-01 GET /api/countries)', () => {
    it('serves seeded country records publicly with currencyCode filtering and pagination', async () => {
      const countries = [
        {
          _id: '507f1f77bcf86cd799439011',
          code: 'EG',
          name: 'Egypt',
          currencyCode: 'EGP',
        },
        {
          _id: '507f1f77bcf86cd799439012',
          code: 'FR',
          name: 'France',
          currencyCode: 'EUR',
        },
        {
          _id: '507f1f77bcf86cd799439013',
          code: 'DE',
          name: 'Germany',
          currencyCode: 'EUR',
        },
      ];

      const filterRows = (filter: Record<string, unknown>) =>
        countries.filter((c) => {
          if (filter.currencyCode && c.currencyCode !== filter.currencyCode) {
            return false;
          }
          if (filter.code && c.code !== filter.code) {
            return false;
          }
          return true;
        });

      const fakeCountryModel = {
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
          { provide: getModelToken(Country.name), useValue: fakeCountryModel },
          { provide: getModelToken(City.name), useValue: {} },
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
          .get('/api/countries?currencyCode=eur&page=1&limit=1')
          .expect(200);

        expect(res.body).toEqual({
          data: [
            {
              id: '507f1f77bcf86cd799439012',
              code: 'FR',
              name: 'France',
              currencyCode: 'EUR',
            },
          ],
          total: 2,
          page: 1,
          limit: 1,
          totalPages: 2,
        });

        await request(app.getHttpServer() as App)
          .get('/api/countries?page=0')
          .expect(400);
      } finally {
        await app.close();
      }
    });
  });
});
