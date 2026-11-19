import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Airport, AirportDocument } from './schemas/airport.schema';
import { Attraction, AttractionDocument } from './schemas/attraction.schema';
import { City, CityDocument } from './schemas/city.schema';
import { Country, CountryDocument } from './schemas/country.schema';

@Injectable()
export class ReferenceDataService {
  constructor(
    @InjectModel(Country.name) readonly countryModel: Model<CountryDocument>,
    @InjectModel(City.name) readonly cityModel: Model<CityDocument>,
    @InjectModel(Airport.name) readonly airportModel: Model<AirportDocument>,
    @InjectModel(Attraction.name)
    readonly attractionModel: Model<AttractionDocument>,
  ) {}

  async hotelLocation(cityId: string, countryId?: string) {
    const city = await this.cityModel.findById(cityId).lean();
    if (!city)
      throw new BadRequestException(
        'City must exist in the seeded reference data',
      );
    if (countryId && !city.country.equals(new Types.ObjectId(countryId))) {
      throw new BadRequestException('Country does not match the selected city');
    }
    const country = await this.countryModel.findById(city.country).lean();
    if (!country)
      throw new BadRequestException('City has no valid seeded country');
    return {
      city: city._id,
      cityName: city.name,
      country: country._id,
      countryCode: country.code,
    };
  }

  async countryIdsMatching(pattern: RegExp) {
    const countries = await this.countryModel
      .find({ $or: [{ name: pattern }, { code: pattern }] })
      .select('_id')
      .lean();
    return countries.map((country) => country._id);
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
}
