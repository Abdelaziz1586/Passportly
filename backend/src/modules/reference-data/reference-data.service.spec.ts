import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ReferenceDataService } from './reference-data.service';
import { Airport } from './schemas/airport.schema';
import { Attraction } from './schemas/attraction.schema';
import { City } from './schemas/city.schema';
import { Country } from './schemas/country.schema';

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
