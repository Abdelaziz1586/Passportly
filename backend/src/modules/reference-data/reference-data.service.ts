import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import {
  AirportItemDto,
  ListAirportsQueryDto,
  PaginatedAirportsResponseDto,
} from './dto/list-airports-query.dto';
import {
  CityItemDto,
  ListCitiesQueryDto,
  PaginatedCitiesResponseDto,
} from './dto/list-cities-query.dto';
import {
  CountryItemDto,
  ListCountriesQueryDto,
  PaginatedCountriesResponseDto,
} from './dto/list-countries-query.dto';
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

type LeanCountry = {
  _id: Types.ObjectId | string;
  externalId?: string;
  code: string;
  name: string;
  currencyCode: string;
  currencyName?: string;
  continent?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

type LeanAirport = {
  _id: Types.ObjectId | string;
  externalId?: string;
  iataCode: string;
  icaoCode?: string;
  name: string;
  city?: Types.ObjectId | string;
  cityName?: string;
  country?: Types.ObjectId | string;
  countryCode?: string;
  timezone: string;
  latitude?: number;
  longitude?: number;
  createdAt?: Date;
  updatedAt?: Date;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function combineConditions(
  conditions: Record<string, unknown>[],
): Record<string, unknown> {
  if (conditions.length === 0) {
    return {};
  }
  return conditions.length === 1 ? conditions[0] : { $and: conditions };
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
   * Lists seeded Countries.csv records with search, filtering, sorting, and pagination
   * so callers can discover supported countries and currency codes.
   */
  async getCountries(
    query: ListCountriesQueryDto,
  ): Promise<PaginatedCountriesResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'name';
    const sortDirection = query.sortOrder === 'desc' ? -1 : 1;

    const conditions: Record<string, unknown>[] = [];

    if (query.code) {
      conditions.push({ code: query.code.trim().toUpperCase() });
    }
    if (query.currencyCode) {
      conditions.push({
        currencyCode: query.currencyCode.trim().toUpperCase(),
      });
    }
    if (query.continent) {
      conditions.push({
        continent: new RegExp(escapeRegex(query.continent.trim()), 'i'),
      });
    }
    if (query.search) {
      const searchRegex = new RegExp(escapeRegex(query.search.trim()), 'i');
      conditions.push({
        $or: [
          { code: searchRegex },
          { name: searchRegex },
          { currencyCode: searchRegex },
          { currencyName: searchRegex },
          { continent: searchRegex },
        ],
      });
    }

    const filter = combineConditions(conditions);

    const [countries, total] = await Promise.all([
      this.countryModel
        .find(filter)
        .sort({ [sortBy]: sortDirection, _id: sortDirection })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanCountry[]>(),
      this.countryModel.countDocuments(filter),
    ]);

    return {
      data: countries.map((country) => this.toCountryItem(country)),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  /**
   * Searches and paginates reference airports with required IANA time zones.
   */
  async getAirports(
    query: ListAirportsQueryDto,
  ): Promise<PaginatedAirportsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'iataCode';
    const sortDirection = query.sortOrder === 'desc' ? -1 : 1;

    const conditions: Record<string, unknown>[] = [];

    if (query.iataCode) {
      conditions.push({ iataCode: query.iataCode.trim().toUpperCase() });
    }
    if (query.name) {
      conditions.push({
        name: new RegExp(escapeRegex(query.name.trim()), 'i'),
      });
    }
    if (query.countryCode) {
      conditions.push({
        countryCode: query.countryCode.trim().toUpperCase(),
      });
    }
    if (query.city) {
      const cityTerm = query.city.trim();
      const cityOr: Record<string, unknown>[] = [
        { cityName: new RegExp(escapeRegex(cityTerm), 'i') },
      ];
      if (isValidObjectId(cityTerm)) {
        cityOr.push({ city: new Types.ObjectId(cityTerm) });
      } else {
        const matchingCities = await this.cityModel
          .find({
            $or: [
              { externalId: new RegExp(`^${escapeRegex(cityTerm)}$`, 'i') },
              { name: new RegExp(escapeRegex(cityTerm), 'i') },
            ],
          })
          .select('_id')
          .lean();
        if (matchingCities.length > 0) {
          cityOr.push({
            city: { $in: matchingCities.map((c) => c._id) },
          });
        }
      }
      conditions.push({ $or: cityOr });
    }
    if (query.search) {
      const searchRegex = new RegExp(escapeRegex(query.search.trim()), 'i');
      conditions.push({
        $or: [
          { iataCode: searchRegex },
          { icaoCode: searchRegex },
          { name: searchRegex },
          { cityName: searchRegex },
          { countryCode: searchRegex },
        ],
      });
    }

    const filter = combineConditions(conditions);

    const [airports, total] = await Promise.all([
      this.airportModel
        .find(filter)
        .sort({ [sortBy]: sortDirection, _id: sortDirection })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanAirport[]>(),
      this.airportModel.countDocuments(filter),
    ]);

    return {
      data: airports.map((airport) => this.toAirportItem(airport)),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

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

    const filter = combineConditions(conditions);

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

  private toCountryItem(country: LeanCountry): CountryItemDto {
    return {
      id: String(country._id),
      ...(country.externalId !== undefined
        ? { externalId: country.externalId }
        : {}),
      code: country.code,
      name: country.name,
      currencyCode: country.currencyCode,
      ...(country.currencyName !== undefined
        ? { currencyName: country.currencyName }
        : {}),
      ...(country.continent !== undefined
        ? { continent: country.continent }
        : {}),
      ...(country.createdAt !== undefined
        ? { createdAt: country.createdAt }
        : {}),
      ...(country.updatedAt !== undefined
        ? { updatedAt: country.updatedAt }
        : {}),
    };
  }

  private toAirportItem(airport: LeanAirport): AirportItemDto {
    return {
      id: String(airport._id),
      ...(airport.externalId !== undefined
        ? { externalId: airport.externalId }
        : {}),
      iataCode: airport.iataCode,
      ...(airport.icaoCode !== undefined ? { icaoCode: airport.icaoCode } : {}),
      name: airport.name,
      ...(airport.city !== undefined ? { cityId: String(airport.city) } : {}),
      ...(airport.cityName !== undefined ? { cityName: airport.cityName } : {}),
      ...(airport.country !== undefined
        ? { countryId: String(airport.country) }
        : {}),
      ...(airport.countryCode !== undefined
        ? { countryCode: airport.countryCode }
        : {}),
      timezone: airport.timezone,
      ...(airport.latitude !== undefined ? { latitude: airport.latitude } : {}),
      ...(airport.longitude !== undefined
        ? { longitude: airport.longitude }
        : {}),
      ...(airport.createdAt !== undefined
        ? { createdAt: airport.createdAt }
        : {}),
      ...(airport.updatedAt !== undefined
        ? { updatedAt: airport.updatedAt }
        : {}),
    };
  }
}
