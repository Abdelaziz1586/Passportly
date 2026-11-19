import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CountryItemDto,
  ListCountriesQueryDto,
  PaginatedCountriesResponseDto,
} from './dto/list-countries-query.dto';
import { Airport, AirportDocument } from './schemas/airport.schema';
import { Attraction, AttractionDocument } from './schemas/attraction.schema';
import { City, CityDocument } from './schemas/city.schema';
import { Country, CountryDocument } from './schemas/country.schema';

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

    const filter: Record<string, unknown> =
      conditions.length === 0
        ? {}
        : conditions.length === 1
          ? conditions[0]
          : { $and: conditions };

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
}
