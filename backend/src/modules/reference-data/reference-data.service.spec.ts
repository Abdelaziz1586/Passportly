import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ReferenceDataService } from './reference-data.service';
import { Airport } from './schemas/airport.schema';
import { Attraction } from './schemas/attraction.schema';
import { City } from './schemas/city.schema';
import { Country } from './schemas/country.schema';

describe('ReferenceDataService (REF-02 getCities)', () => {
  let service: ReferenceDataService;

  const mockCityModel = {
    find: jest.fn(),
    countDocuments: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReferenceDataService,
        {
          provide: getModelToken(Country.name),
          useValue: { estimatedDocumentCount: jest.fn(), exists: jest.fn() },
        },
        { provide: getModelToken(City.name), useValue: mockCityModel },
        { provide: getModelToken(Airport.name), useValue: {} },
        { provide: getModelToken(Attraction.name), useValue: {} },
      ],
    }).compile();

    service = module.get<ReferenceDataService>(ReferenceDataService);
  });

  function mockCityQuery(items: Record<string, unknown>[], total: number) {
    const leanMock = jest.fn().mockResolvedValue(items);
    const limitMock = jest.fn().mockReturnValue({ lean: leanMock });
    const skipMock = jest.fn().mockReturnValue({ limit: limitMock });
    const sortMock = jest.fn().mockReturnValue({ skip: skipMock });
    mockCityModel.find.mockReturnValue({ sort: sortMock });
    mockCityModel.countDocuments.mockResolvedValue(total);
    return { sortMock, skipMock, limitMock };
  }

  it('lists paginated cities sorted ascending by name', async () => {
    const { sortMock, skipMock, limitMock } = mockCityQuery(
      [
        {
          _id: '507f1f77bcf86cd799439021',
          externalId: 'cairo',
          name: 'Cairo',
          country: '507f1f77bcf86cd799439011',
          countryCode: 'EG',
        },
      ],
      1,
    );

    const result = await service.getCities({ page: 1, limit: 20 });

    expect(mockCityModel.find).toHaveBeenCalledWith({});
    expect(sortMock).toHaveBeenCalledWith({ name: 1, _id: 1 });
    expect(skipMock).toHaveBeenCalledWith(0);
    expect(limitMock).toHaveBeenCalledWith(20);
    expect(result).toEqual({
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
      limit: 20,
      totalPages: 1,
    });
  });

  it('filters by countryCode and search query cleanly with $and', async () => {
    const { sortMock, skipMock, limitMock } = mockCityQuery([], 0);

    const result = await service.getCities({
      countryCode: 'eg',
      search: 'Cai',
      page: 2,
      limit: 10,
      sortBy: 'countryCode',
      sortOrder: 'desc',
    });

    const findCalls = mockCityModel.find.mock.calls as [
      [Record<string, unknown>],
    ];
    const filter = findCalls[0][0];
    expect(Array.isArray(filter.$and)).toBe(true);
    expect(filter.$and).toHaveLength(2);
    expect(sortMock).toHaveBeenCalledWith({ countryCode: -1, _id: -1 });
    expect(skipMock).toHaveBeenCalledWith(10);
    expect(limitMock).toHaveBeenCalledWith(10);
    expect(result.totalPages).toBe(0);
  });
});
