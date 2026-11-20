import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ReferenceDataService } from './reference-data.service';
import { Airport } from './schemas/airport.schema';
import { Attraction } from './schemas/attraction.schema';
import { City } from './schemas/city.schema';
import { Country } from './schemas/country.schema';

describe('ReferenceDataService (FLT-02 getAirports)', () => {
  let service: ReferenceDataService;

  const mockAirportModel = {
    find: jest.fn(),
    countDocuments: jest.fn(),
  };

  const mockCityModel = {
    find: jest.fn(),
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
        { provide: getModelToken(Airport.name), useValue: mockAirportModel },
        { provide: getModelToken(Attraction.name), useValue: {} },
      ],
    }).compile();

    service = module.get<ReferenceDataService>(ReferenceDataService);
  });

  function mockAirportQuery(items: Record<string, unknown>[], total: number) {
    const leanMock = jest.fn().mockResolvedValue(items);
    const limitMock = jest.fn().mockReturnValue({ lean: leanMock });
    const skipMock = jest.fn().mockReturnValue({ limit: limitMock });
    const sortMock = jest.fn().mockReturnValue({ skip: skipMock });
    mockAirportModel.find.mockReturnValue({ sort: sortMock });
    mockAirportModel.countDocuments.mockResolvedValue(total);
    return { sortMock, skipMock, limitMock };
  }

  it('lists paginated airports including required IANA timezone with default sorting', async () => {
    const { sortMock, skipMock, limitMock } = mockAirportQuery(
      [
        {
          _id: '507f1f77bcf86cd799439011',
          iataCode: 'CAI',
          name: 'Cairo International Airport',
          city: '507f1f77bcf86cd799439021',
          cityName: 'Cairo',
          country: '507f1f77bcf86cd799439031',
          countryCode: 'EG',
          timezone: 'Africa/Cairo',
        },
      ],
      1,
    );

    const result = await service.getAirports({ page: 1, limit: 20 });

    expect(mockAirportModel.find).toHaveBeenCalledWith({});
    expect(sortMock).toHaveBeenCalledWith({ iataCode: 1, _id: 1 });
    expect(skipMock).toHaveBeenCalledWith(0);
    expect(limitMock).toHaveBeenCalledWith(20);
    expect(result).toEqual({
      data: [
        {
          id: '507f1f77bcf86cd799439011',
          iataCode: 'CAI',
          name: 'Cairo International Airport',
          cityId: '507f1f77bcf86cd799439021',
          cityName: 'Cairo',
          countryId: '507f1f77bcf86cd799439031',
          countryCode: 'EG',
          timezone: 'Africa/Cairo',
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  it('combines iataCode, name, city (matching City records), countryCode, and search filters cleanly', async () => {
    mockCityModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([{ _id: '507f1f77bcf86cd799439021' }]),
      }),
    });
    const { skipMock, limitMock } = mockAirportQuery([], 0);

    const result = await service.getAirports({
      iataCode: 'cai',
      name: 'Cairo (Intl)',
      city: 'cairo',
      countryCode: 'eg',
      search: 'Africa',
      page: 2,
      limit: 5,
      sortBy: 'name',
      sortOrder: 'desc',
    });

    const findCalls = mockAirportModel.find.mock.calls as [
      [Record<string, unknown>],
    ];
    const filter = findCalls[0][0];
    expect(Array.isArray(filter.$and)).toBe(true);
    expect(filter.$and).toHaveLength(5);
    expect(skipMock).toHaveBeenCalledWith(5);
    expect(limitMock).toHaveBeenCalledWith(5);
    expect(result.totalPages).toBe(0);
  });
});
