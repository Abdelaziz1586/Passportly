import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
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

describe('ReferenceDataService (REF-03 getAttractions)', () => {
  let service: ReferenceDataService;

  const mockAttractionModel = {
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
        { provide: getModelToken(Airport.name), useValue: {} },
        {
          provide: getModelToken(Attraction.name),
          useValue: mockAttractionModel,
        },
      ],
    }).compile();

    service = module.get<ReferenceDataService>(ReferenceDataService);
  });

  function mockAttractionQuery(
    items: Record<string, unknown>[],
    total: number,
  ) {
    const leanMock = jest.fn().mockResolvedValue(items);
    const limitMock = jest.fn().mockReturnValue({ lean: leanMock });
    const skipMock = jest.fn().mockReturnValue({ limit: limitMock });
    const sortMock = jest.fn().mockReturnValue({ skip: skipMock });
    const populateMock = jest.fn().mockReturnValue({ sort: sortMock });
    mockAttractionModel.find.mockReturnValue({ populate: populateMock });
    mockAttractionModel.countDocuments.mockResolvedValue(total);
    return { populateMock, sortMock, skipMock, limitMock };
  }

  it('lists paginated attractions and resolves countryCode/cityName from populated City when missing on Attraction', async () => {
    const cityObjectId = new Types.ObjectId('507f1f77bcf86cd799439021');
    const countryObjectId = new Types.ObjectId('507f1f77bcf86cd799439011');
    const { populateMock, sortMock } = mockAttractionQuery(
      [
        {
          _id: '507f1f77bcf86cd799439051',
          externalId: 'att-1',
          name: 'Giza Pyramids and Sphinx',
          city: {
            _id: cityObjectId,
            name: 'Cairo',
            country: countryObjectId,
            countryCode: 'EG',
          },
          cityName: 'Cairo',
        },
      ],
      1,
    );

    const result = await service.getAttractions({ page: 1, limit: 20 });

    expect(mockAttractionModel.find).toHaveBeenCalledWith({});
    expect(populateMock).toHaveBeenCalledWith(
      'city',
      'name country countryCode',
    );
    expect(sortMock).toHaveBeenCalledWith({ name: 1, _id: 1 });
    expect(result).toEqual({
      data: [
        {
          id: '507f1f77bcf86cd799439051',
          externalId: 'att-1',
          name: 'Giza Pyramids and Sphinx',
          cityId: String(cityObjectId),
          cityName: 'Cairo',
          countryId: String(countryObjectId),
          countryCode: 'EG',
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  it('resolves external cityId (e.g., cairo) and returns empty result cleanly when cityId matches no city', async () => {
    const cairoId = new Types.ObjectId('507f1f77bcf86cd799439021');
    mockCityModel.find.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ _id: cairoId }]),
      }),
    });
    mockAttractionQuery([], 0);

    await service.getAttractions({ cityId: 'cairo' });

    const findCalls = mockAttractionModel.find.mock.calls as [
      [Record<string, unknown>],
    ];
    expect(findCalls[0][0]).toEqual({ city: { $in: [cairoId] } });

    jest.clearAllMocks();
    mockCityModel.find.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    });

    const emptyRes = await service.getAttractions({ cityId: 'unknown-city' });
    expect(mockAttractionModel.find).not.toHaveBeenCalled();
    expect(emptyRes).toEqual({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });
  });

  it('filters by ObjectId cityId, cityName, countryCode (via City relation), category, and search cleanly', async () => {
    const cityObjectId = '507f1f77bcf86cd799439021';
    mockCityModel.find
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ _id: cityObjectId }]),
        }),
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ _id: cityObjectId }]),
        }),
      });
    mockAttractionQuery([], 0);

    await service.getAttractions({
      cityId: cityObjectId,
      cityName: 'Cairo',
      countryCode: 'eg',
      category: 'Historical',
      search: 'Pyramids',
      page: 2,
      limit: 5,
    });

    const findCalls = mockAttractionModel.find.mock.calls as [
      [Record<string, unknown>],
    ];
    const filter = findCalls[0][0];
    expect(Array.isArray(filter.$and)).toBe(true);
    expect(filter.$and).toHaveLength(5);
  });
});
