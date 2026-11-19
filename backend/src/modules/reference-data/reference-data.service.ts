import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CityItemDto,
  ListCitiesQueryDto,
  PaginatedCitiesResponseDto,
} from './dto/list-cities-query.dto';
import { Airport, AirportDocument } from './schemas/airport.schema';
import { Attraction, AttractionDocument } from './schemas/attraction.schema';
import { City, CityDocument } from './schemas/city.schema';
import { Country, CountryDocument } from './schemas/country.schema';

type LeanCity = {
  _id: Types.ObjectId | string;
  externalId?: string;
  name: string;
  country: Types.ObjectId | string;
  countryCode: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
   * Filters seeded Cities.csv records by countryCode and search term with pagination.
   */
  async getCities(
    query: ListCitiesQueryDto,
  ): Promise<PaginatedCitiesResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'name';
    const sortDirection = query.sortOrder === 'desc' ? -1 : 1;

    const conditions: Record<string, unknown>[] = [];

    if (query.countryCode) {
      conditions.push({ countryCode: query.countryCode.trim().toUpperCase() });
    }
    if (query.search) {
      const searchRegex = new RegExp(escapeRegex(query.search.trim()), 'i');
      conditions.push({
        $or: [
          { name: searchRegex },
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

    const [cities, total] = await Promise.all([
      this.cityModel
        .find(filter)
        .sort({ [sortBy]: sortDirection, _id: sortDirection })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanCity[]>(),
      this.cityModel.countDocuments(filter),
    ]);

    return {
      data: cities.map((city) => this.toCityItem(city)),
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

  private toCityItem(city: LeanCity): CityItemDto {
    return {
      id: String(city._id),
      ...(city.externalId !== undefined ? { externalId: city.externalId } : {}),
      name: city.name,
      countryId: String(city.country),
      countryCode: city.countryCode,
      ...(city.latitude !== undefined ? { latitude: city.latitude } : {}),
      ...(city.longitude !== undefined ? { longitude: city.longitude } : {}),
      ...(city.timezone !== undefined ? { timezone: city.timezone } : {}),
      ...(city.createdAt !== undefined ? { createdAt: city.createdAt } : {}),
      ...(city.updatedAt !== undefined ? { updatedAt: city.updatedAt } : {}),
    };
  }
}
