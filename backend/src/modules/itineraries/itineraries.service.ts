import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  Model,
  Error as MongooseError,
  Types,
  isValidObjectId,
} from 'mongoose';
import { ItineraryVisibility } from '../../common/enums';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { Activity, ActivityDocument } from './schemas/activity.schema';
import {
  BudgetEntry,
  BudgetEntryDocument,
} from './schemas/budget-entry.schema';
import {
  ExchangeRate,
  ExchangeRateDocument,
} from './schemas/exchange-rate.schema';
import { Itinerary, ItineraryDocument } from './schemas/itinerary.schema';
import {
  TransportCost,
  TransportCostDocument,
} from './schemas/transport-cost.schema';

@Injectable()
export class ItinerariesService {
  constructor(
    @InjectModel(Itinerary.name)
    readonly itineraryModel: Model<ItineraryDocument>,
    @InjectModel(Activity.name)
    readonly activityModel: Model<ActivityDocument>,
    @InjectModel(BudgetEntry.name)
    readonly budgetEntryModel: Model<BudgetEntryDocument>,
    @InjectModel(TransportCost.name)
    readonly transportCostModel: Model<TransportCostDocument>,
    @InjectModel(ExchangeRate.name)
    readonly exchangeRateModel: Model<ExchangeRateDocument>,
    readonly httpService: HttpService,
    readonly configService: ConfigService,
    readonly referenceDataService: ReferenceDataService,
  ) {}

  async createItinerary(
    userId: string,
    dto: CreateItineraryDto,
  ): Promise<ItineraryDocument> {
    const title = dto.title.trim();
    if (!title) {
      throw new BadRequestException('title must not be empty');
    }

    const startDate = this.parseDate(dto.startDate, 'startDate');
    const countryIds = await this.validateCountryIds(dto.countries ?? []);
    const displayCurrency = (dto.displayCurrency ?? 'USD').trim().toUpperCase();
    await this.assertSupportedCurrency(displayCurrency);

    const itinerary = new this.itineraryModel({
      user: this.objectId(userId, 'userId'),
      title,
      ...(dto.description?.trim()
        ? { description: dto.description.trim() }
        : {}),
      countries: countryIds,
      startDate,
      displayCurrency,
      visibility: ItineraryVisibility.PRIVATE,
    });

    return this.saveItinerary(itinerary);
  }

  private async validateCountryIds(
    countryIds: string[],
  ): Promise<Types.ObjectId[]> {
    const ids = countryIds.map((id) => this.objectId(id, 'countries'));
    if (ids.length === 0) return ids;
    const matchingCountries = await this.referenceDataService.countryModel
      .countDocuments({ _id: { $in: ids } })
      .exec();
    if (matchingCountries !== ids.length) {
      throw new BadRequestException(
        'countries must contain existing country IDs',
      );
    }
    return ids;
  }

  private async assertSupportedCurrency(currency: string): Promise<void> {
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BadRequestException(
        'Currency must be a 3-letter ISO currency code',
      );
    }
    if (
      !(await this.referenceDataService.countryModel.exists({
        currencyCode: currency,
      }))
    ) {
      throw new BadRequestException(
        'Currency is not supported by reference data',
      );
    }
  }

  private objectId(value: string, fieldName: string): Types.ObjectId {
    if (!isValidObjectId(value)) {
      throw new BadRequestException(`${fieldName} must be a valid MongoDB ID`);
    }
    return new Types.ObjectId(value);
  }

  private parseDate(value: string, fieldName: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${fieldName} must be a valid date`);
    }
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }

  private async saveItinerary(
    itinerary: ItineraryDocument,
    session?: import('mongoose').ClientSession,
  ): Promise<ItineraryDocument> {
    try {
      return await itinerary.save({ session });
    } catch (error: unknown) {
      if (error instanceof MongooseError.VersionError) {
        throw new ConflictException('Itinerary changed; reload it and retry');
      }
      throw error;
    }
  }
}
