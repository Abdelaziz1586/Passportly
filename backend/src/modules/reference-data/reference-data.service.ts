import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import {
  AttractionItemDto,
  ListAttractionsQueryDto,
  PaginatedAttractionsResponseDto,
} from './dto/list-attractions-query.dto';
import { Airport, AirportDocument } from './schemas/airport.schema';
import { Attraction, AttractionDocument } from './schemas/attraction.schema';
import { City, CityDocument } from './schemas/city.schema';
import { Country, CountryDocument } from './schemas/country.schema';

type PopulatedCityRef = {
  _id: Types.ObjectId | string;
  name?: string;
  country?: Types.ObjectId | string;
  countryCode?: string;
};

type LeanAttraction = {
  _id: Types.ObjectId | string;
  externalId?: string;
  name: string;
  city?: PopulatedCityRef | Types.ObjectId | string;
  cityName?: string;
  country?: Types.ObjectId | string;
  countryCode?: string;
  category?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  estimatedCost?: number;
  currency?: string;
  imageUrl?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPopulatedCity(
  city: PopulatedCityRef | Types.ObjectId | string | undefined,
): city is PopulatedCityRef {
  return (
    typeof city === 'object' &&
    city !== null &&
    '_id' in city &&
    !('toHexString' in city && typeof city.toHexString === 'function')
  );
}

@Injectable()
export class ReferenceDataService {
  constructor(
    @InjectModel(Country.name) readonly countryModel: Model<CountryDocument>,
    @InjectModel(City.name) readonly cityModel: Model<CityDocument>,
    @InjectModel(Airport.name) readonly airportModel: Model<AirportDocument>,
    @InjectModel(Attraction.name)
    readonly attractionModel: Model<AttractionDocument>,
  ) {}

  /**
   * Filters seeded Attractions.csv records by cityId/cityName, countryCode,
   * category, or search term with pagination.
   */
  async getAttractions(
    query: ListAttractionsQueryDto,
  ): Promise<PaginatedAttractionsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'name';
    const sortDirection = query.sortOrder === 'desc' ? -1 : 1;

    const conditions: Record<string, unknown>[] = [];

    if (query.cityId) {
      const cityTerm = query.cityId.trim();
      if (isValidObjectId(cityTerm)) {
        conditions.push({ city: new Types.ObjectId(cityTerm) });
      } else {
        const matchedCities = await this.cityModel
          .find({
            externalId: new RegExp(`^${escapeRegex(cityTerm)}$`, 'i'),
          })
          .select('_id')
          .lean();
        if (matchedCities.length === 0) {
          return {
            data: [],
            total: 0,
            page,
            limit,
            totalPages: 0,
          };
        }
        conditions.push({
          city: { $in: matchedCities.map((c) => c._id) },
        });
      }
    }

    if (query.cityName) {
      const cityNameRegex = new RegExp(escapeRegex(query.cityName.trim()), 'i');
      const matchedCities = await this.cityModel
        .find({ name: cityNameRegex })
        .select('_id')
        .lean();
      conditions.push({
        $or: [
          { cityName: cityNameRegex },
          ...(matchedCities.length > 0
            ? [{ city: { $in: matchedCities.map((c) => c._id) } }]
            : []),
        ],
      });
    }

    if (query.countryCode) {
      const normalizedCountryCode = query.countryCode.trim().toUpperCase();
      const citiesInCountry = await this.cityModel
        .find({ countryCode: normalizedCountryCode })
        .select('_id')
        .lean();
      conditions.push({
        $or: [
          { countryCode: normalizedCountryCode },
          ...(citiesInCountry.length > 0
            ? [{ city: { $in: citiesInCountry.map((c) => c._id) } }]
            : []),
        ],
      });
    }

    if (query.category) {
      conditions.push({
        category: new RegExp(escapeRegex(query.category.trim()), 'i'),
      });
    }

    if (query.search) {
      const searchRegex = new RegExp(escapeRegex(query.search.trim()), 'i');
      conditions.push({
        $or: [
          { name: searchRegex },
          { description: searchRegex },
          { category: searchRegex },
          { cityName: searchRegex },
          { countryCode: searchRegex },
          { externalId: searchRegex },
        ],
      });
    }

    const filter: Record<string, unknown> =
      conditions.length === 0
        ? {}
        : conditions.length === 1
          ? conditions[0]
          : { $and: conditions };

    const [attractions, total] = await Promise.all([
      this.attractionModel
        .find(filter)
        .populate('city', 'name country countryCode')
        .sort({ [sortBy]: sortDirection, _id: sortDirection })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanAttraction[]>(),
      this.attractionModel.countDocuments(filter),
    ]);

    return {
      data: attractions.map((attraction) => this.toAttractionItem(attraction)),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  /**
   * Validates a 3-letter ISO currency code against seeded Country records.
   * Allows valid format when reference data has not yet been seeded.
   */
  async isCurrencySupported(currencyCode: string): Promise<boolean> {
    const normalized = currencyCode.trim().toUpperCase();
    const totalCountries = await this.countryModel.estimatedDocumentCount();
    if (totalCountries === 0) {
      return true;
    }
    const match = await this.countryModel.exists({ currencyCode: normalized });
    return match !== null;
  }

  private toAttractionItem(attraction: LeanAttraction): AttractionItemDto {
    let cityId: string | undefined;
    let cityName = attraction.cityName;
    let countryId =
      attraction.country !== undefined ? String(attraction.country) : undefined;
    let countryCode = attraction.countryCode;

    if (isPopulatedCity(attraction.city)) {
      cityId = String(attraction.city._id);
      cityName = cityName ?? attraction.city.name;
      countryId =
        countryId ??
        (attraction.city.country !== undefined
          ? String(attraction.city.country)
          : undefined);
      countryCode = countryCode ?? attraction.city.countryCode;
    } else if (attraction.city !== undefined) {
      cityId = String(attraction.city);
    }

    return {
      id: String(attraction._id),
      ...(attraction.externalId !== undefined
        ? { externalId: attraction.externalId }
        : {}),
      name: attraction.name,
      ...(cityId !== undefined ? { cityId } : {}),
      ...(cityName !== undefined ? { cityName } : {}),
      ...(countryId !== undefined ? { countryId } : {}),
      ...(countryCode !== undefined ? { countryCode } : {}),
      ...(attraction.category !== undefined
        ? { category: attraction.category }
        : {}),
      ...(attraction.description !== undefined
        ? { description: attraction.description }
        : {}),
      ...(attraction.latitude !== undefined
        ? { latitude: attraction.latitude }
        : {}),
      ...(attraction.longitude !== undefined
        ? { longitude: attraction.longitude }
        : {}),
      ...(attraction.estimatedCost !== undefined
        ? { estimatedCost: attraction.estimatedCost }
        : {}),
      ...(attraction.currency !== undefined
        ? { currency: attraction.currency }
        : {}),
      ...(attraction.imageUrl !== undefined
        ? { imageUrl: attraction.imageUrl }
        : {}),
      ...(attraction.createdAt !== undefined
        ? { createdAt: attraction.createdAt }
        : {}),
      ...(attraction.updatedAt !== undefined
        ? { updatedAt: attraction.updatedAt }
        : {}),
    };
  }
}
