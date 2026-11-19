import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ReferenceDataService } from './reference-data.service';
import { Airport } from './schemas/airport.schema';
import { Attraction } from './schemas/attraction.schema';
import { City } from './schemas/city.schema';
import { Country } from './schemas/country.schema';

describe('ReferenceDataService (REF-01 getCountries)', () => {
  let service: ReferenceDataService;

  const mockCountryModel = {
    find: jest.fn(),
    countDocuments: jest.fn(),
    estimatedDocumentCount: jest.fn(),
    exists: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReferenceDataService,
        { provide: getModelToken(Country.name), useValue: mockCountryModel },
        { provide: getModelToken(City.name), useValue: {} },
        { provide: getModelToken(Airport.name), useValue: {} },
        { provide: getModelToken(Attraction.name), useValue: {} },
      ],
    }).compile();

    service = module.get<ReferenceDataService>(ReferenceDataService);
  });

  function mockCountryQuery(items: Record<string, unknown>[], total: number) {
    const leanMock = jest.fn().mockResolvedValue(items);
    const limitMock = jest.fn().mockReturnValue({ lean: leanMock });
    const skipMock = jest.fn().mockReturnValue({ limit: limitMock });
    const sortMock = jest.fn().mockReturnValue({ skip: skipMock });
    mockCountryModel.find.mockReturnValue({ sort: sortMock });
    mockCountryModel.countDocuments.mockResolvedValue(total);
    return { sortMock, skipMock, limitMock };
  }

  it('returns paginated countries and supported currency codes sorted ascending by name', async () => {
    const { sortMock, skipMock, limitMock } = mockCountryQuery(
      [
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
      ],
      2,
    );

    const result = await service.getCountries({ page: 1, limit: 20 });

    expect(mockCountryModel.find).toHaveBeenCalledWith({});
    expect(sortMock).toHaveBeenCalledWith({ name: 1, _id: 1 });
    expect(skipMock).toHaveBeenCalledWith(0);
    expect(limitMock).toHaveBeenCalledWith(20);
    expect(result).toEqual({
      data: [
        {
          id: '507f1f77bcf86cd799439011',
          code: 'EG',
          name: 'Egypt',
          currencyCode: 'EGP',
        },
        {
          id: '507f1f77bcf86cd799439012',
          code: 'FR',
          name: 'France',
          currencyCode: 'EUR',
        },
      ],
      total: 2,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  it('filters by code, currencyCode, continent, and search cleanly with $and', async () => {
    const { sortMock, skipMock, limitMock } = mockCountryQuery([], 0);

    const result = await service.getCountries({
      code: 'eg',
      currencyCode: 'egp',
      continent: 'Africa',
      search: 'Egypt (EG)',
      page: 2,
      limit: 5,
      sortBy: 'currencyCode',
      sortOrder: 'desc',
    });

    const findCalls = mockCountryModel.find.mock.calls as [
      [Record<string, unknown>],
    ];
    const filter = findCalls[0][0];
    expect(Array.isArray(filter.$and)).toBe(true);
    expect(filter.$and).toHaveLength(4);
    expect(sortMock).toHaveBeenCalledWith({ currencyCode: -1, _id: -1 });
    expect(skipMock).toHaveBeenCalledWith(5);
    expect(limitMock).toHaveBeenCalledWith(5);
    expect(result.totalPages).toBe(0);
  });
});
