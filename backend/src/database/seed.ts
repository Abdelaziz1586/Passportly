import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import { Model } from 'mongoose';
import * as path from 'path';
import { AppModule } from '../app.module';
import { AccountStatus, Role } from '../common/enums';
import {
  Airport,
  AirportDocument,
} from '../modules/reference-data/schemas/airport.schema';
import {
  Attraction,
  AttractionDocument,
} from '../modules/reference-data/schemas/attraction.schema';
import {
  City,
  CityDocument,
} from '../modules/reference-data/schemas/city.schema';
import {
  Country,
  CountryDocument,
} from '../modules/reference-data/schemas/country.schema';
import { User, UserDocument } from '../modules/users/schemas/user.schema';

const logger = new Logger('DatabaseSeed');

function readCsvIfExists(filePath: string): Record<string, string>[] {
  if (!fs.existsSync(filePath)) {
    logger.warn(`Reference file not found, skipping: ${filePath}`);
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return parse<Record<string, string>>(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

function pickField(
  row: Record<string, string>,
  candidates: string[],
): string | undefined {
  for (const key of candidates) {
    const match = Object.keys(row).find(
      (k) => k.toLowerCase() === key.toLowerCase(),
    );
    if (match && row[match] !== '') {
      return row[match];
    }
  }
  return undefined;
}

async function seedAdmin(
  userModel: Model<UserDocument>,
  configService: ConfigService,
) {
  const email = configService
    .get<string>('seedAdmin.email', 'admin@travelplatform.local')
    .toLowerCase();
  const password = configService.get<string>(
    'seedAdmin.password',
    'ChangeMe123!',
  );

  const existing = await userModel.findOne({ email });
  if (existing) {
    logger.log(`Admin account already exists: ${email}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await userModel.create({
    email,
    passwordHash,
    firstName: 'Platform',
    lastName: 'Administrator',
    role: Role.ADMIN,
    status: AccountStatus.ACTIVE,
    isEmailVerified: true,
    preferredCurrency: 'USD',
  });
  logger.log(`Seeded default administrator account: ${email}`);
}

async function seedReferenceData(models: {
  countryModel: Model<CountryDocument>;
  cityModel: Model<CityDocument>;
  airportModel: Model<AirportDocument>;
  attractionModel: Model<AttractionDocument>;
}) {
  const refDir = path.resolve(__dirname, '../../data/reference');

  // 1. Countries
  const countriesRows = readCsvIfExists(path.join(refDir, 'Countries.csv'));
  for (const row of countriesRows) {
    const code = pickField(row, ['code', 'country_code', 'iso2', 'iso_code']);
    const name = pickField(row, ['name', 'country_name', 'country']);
    const currencyCode = pickField(row, [
      'currency_code',
      'currencyCode',
      'currency',
    ]);
    if (!code || !name || !currencyCode) continue;

    await models.countryModel.updateOne(
      { code: code.toUpperCase() },
      {
        $set: {
          externalId: pickField(row, ['id', 'country_id']),
          code: code.toUpperCase(),
          name,
          currencyCode: currencyCode.toUpperCase(),
          currencyName: pickField(row, ['currency_name', 'currencyName']),
          continent: pickField(row, ['continent', 'region']),
        },
      },
      { upsert: true },
    );
  }
  if (countriesRows.length > 0) {
    logger.log(`Processed ${countriesRows.length} rows from Countries.csv`);
  }

  const countries = await models.countryModel.find().lean();
  const countryByCode = new Map(countries.map((c) => [c.code, c]));
  const countryByExternalId = new Map(
    countries.filter((c) => c.externalId).map((c) => [c.externalId!, c]),
  );

  // 2. Cities
  const citiesRows = readCsvIfExists(path.join(refDir, 'Cities.csv'));
  for (const row of citiesRows) {
    const name = pickField(row, ['name', 'city_name', 'city']);
    const countryCodeRaw = pickField(row, ['country_code', 'countryCode']);
    const countryExtId = pickField(row, ['country_id', 'countryId']);
    const countryDoc =
      (countryCodeRaw && countryByCode.get(countryCodeRaw.toUpperCase())) ||
      (countryExtId && countryByExternalId.get(countryExtId));

    if (!name || !countryDoc) continue;

    const lat = pickField(row, ['latitude', 'lat']);
    const lng = pickField(row, ['longitude', 'lng', 'lon']);

    await models.cityModel.updateOne(
      { name, countryCode: countryDoc.code },
      {
        $set: {
          externalId: pickField(row, ['id', 'city_id']),
          name,
          country: countryDoc._id,
          countryCode: countryDoc.code,
          latitude: lat ? Number(lat) : undefined,
          longitude: lng ? Number(lng) : undefined,
          timezone: pickField(row, ['timezone', 'iana_timezone']),
        },
      },
      { upsert: true },
    );
  }
  if (citiesRows.length > 0) {
    logger.log(`Processed ${citiesRows.length} rows from Cities.csv`);
  }

  const cities = await models.cityModel.find().lean();
  const cityByNameAndCountry = new Map(
    cities.map((c) => [`${c.name.toLowerCase()}::${c.countryCode}`, c]),
  );
  const cityByExternalId = new Map(
    cities.filter((c) => c.externalId).map((c) => [c.externalId!, c]),
  );

  // 3. Airports
  const airportsRows = readCsvIfExists(path.join(refDir, 'Airports.csv'));
  for (const row of airportsRows) {
    const iataCode = pickField(row, ['iata_code', 'iata', 'code']);
    const name = pickField(row, ['name', 'airport_name']);
    const timezone = pickField(row, [
      'timezone',
      'iana_timezone',
      'tz',
      'time_zone',
    ]);
    if (!iataCode || !name || !timezone) continue;

    const countryCodeRaw = pickField(row, ['country_code', 'countryCode']);
    const cityName = pickField(row, ['city_name', 'city']);
    const cityExtId = pickField(row, ['city_id', 'cityId']);
    const countryDoc = countryCodeRaw
      ? countryByCode.get(countryCodeRaw.toUpperCase())
      : undefined;
    const cityDoc =
      (cityExtId && cityByExternalId.get(cityExtId)) ||
      (cityName && countryDoc
        ? cityByNameAndCountry.get(
            `${cityName.toLowerCase()}::${countryDoc.code}`,
          )
        : undefined);

    const lat = pickField(row, ['latitude', 'lat']);
    const lng = pickField(row, ['longitude', 'lng', 'lon']);

    await models.airportModel.updateOne(
      { iataCode: iataCode.toUpperCase() },
      {
        $set: {
          externalId: pickField(row, ['id', 'airport_id']),
          iataCode: iataCode.toUpperCase(),
          icaoCode: pickField(row, ['icao_code', 'icao'])?.toUpperCase(),
          name,
          city: cityDoc?._id,
          cityName: cityName ?? cityDoc?.name,
          country: countryDoc?._id,
          countryCode: countryDoc?.code ?? countryCodeRaw?.toUpperCase(),
          timezone,
          latitude: lat ? Number(lat) : undefined,
          longitude: lng ? Number(lng) : undefined,
        },
      },
      { upsert: true },
    );
  }
  if (airportsRows.length > 0) {
    logger.log(`Processed ${airportsRows.length} rows from Airports.csv`);
  }

  // 4. Attractions
  const attractionsRows = readCsvIfExists(path.join(refDir, 'Attractions.csv'));
  for (const row of attractionsRows) {
    const name = pickField(row, ['name', 'attraction_name', 'title']);
    if (!name) continue;

    const countryCodeRaw = pickField(row, ['country_code', 'countryCode']);
    const cityName = pickField(row, ['city_name', 'city']);
    const cityExtId = pickField(row, ['city_id', 'cityId']);
    const countryDoc = countryCodeRaw
      ? countryByCode.get(countryCodeRaw.toUpperCase())
      : undefined;
    const cityDoc =
      (cityExtId && cityByExternalId.get(cityExtId)) ||
      (cityName && countryDoc
        ? cityByNameAndCountry.get(
            `${cityName.toLowerCase()}::${countryDoc.code}`,
          )
        : undefined);

    const lat = pickField(row, ['latitude', 'lat']);
    const lng = pickField(row, ['longitude', 'lng', 'lon']);
    const cost = pickField(row, ['estimated_cost', 'cost', 'price']);

    await models.attractionModel.updateOne(
      {
        name,
        ...(cityDoc ? { city: cityDoc._id } : {}),
      },
      {
        $set: {
          externalId: pickField(row, ['id', 'attraction_id']),
          name,
          city: cityDoc?._id,
          cityName: cityName ?? cityDoc?.name,
          country: countryDoc?._id,
          countryCode: countryDoc?.code ?? countryCodeRaw?.toUpperCase(),
          category: pickField(row, ['category', 'type']),
          description: pickField(row, ['description']),
          latitude: lat ? Number(lat) : undefined,
          longitude: lng ? Number(lng) : undefined,
          estimatedCost: cost ? Number(cost) : undefined,
          currency: pickField(row, ['currency', 'currency_code']),
          imageUrl: pickField(row, ['image_url', 'imageUrl']),
        },
      },
      { upsert: true },
    );
  }
  if (attractionsRows.length > 0) {
    logger.log(`Processed ${attractionsRows.length} rows from Attractions.csv`);
  }
}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const configService = app.get(ConfigService);
    const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    const countryModel = app.get<Model<CountryDocument>>(
      getModelToken(Country.name),
    );
    const cityModel = app.get<Model<CityDocument>>(getModelToken(City.name));
    const airportModel = app.get<Model<AirportDocument>>(
      getModelToken(Airport.name),
    );
    const attractionModel = app.get<Model<AttractionDocument>>(
      getModelToken(Attraction.name),
    );

    await seedAdmin(userModel, configService);
    await seedReferenceData({
      countryModel,
      cityModel,
      airportModel,
      attractionModel,
    });
    logger.log('Database seed completed.');
  } finally {
    await app.close();
  }
}

bootstrap().catch((err) => {
  logger.error('Database seed failed', err);
  process.exit(1);
});
