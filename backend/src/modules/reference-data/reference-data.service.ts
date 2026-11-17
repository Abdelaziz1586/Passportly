import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
}
