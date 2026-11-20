import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  Model,
  Error as MongooseError,
  QueryFilter,
  Types,
  isValidObjectId,
} from 'mongoose';
import { ItineraryVisibility, Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { ListItinerariesQueryDto } from './dto/itinerary-endpoints.dto';
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

  async listMyItineraries(userId: string, query: ListItinerariesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter: QueryFilter<ItineraryDocument> = {
      user: this.objectId(userId, 'userId'),
    };
    if (query.visibility) filter.visibility = query.visibility;
    if (query.search?.trim()) {
      const search = new RegExp(this.escapeRegex(query.search.trim()), 'i');
      filter.$or = [{ title: search }, { description: search }];
    }

    const [items, total] = await Promise.all([
      this.itineraryModel
        .find(filter)
        .sort(this.sortOptions(query.sortBy, query.sortOrder))
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.itineraryModel.countDocuments(filter).exec(),
    ]);
    return {
      items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getItinerary(
    id: string,
    user: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const itinerary = await this.findItineraryById(id);
    this.assertOwner(itinerary, user.userId, user.role === Role.ADMIN);
    return this.getItineraryDetails(itinerary);
  }

  private async getItineraryDetails(
    itinerary: ItineraryDocument,
  ): Promise<Record<string, unknown>> {
    const [activities, budgetEntries, transportCosts] = await Promise.all([
      this.activityModel
        .find({ itinerary: itinerary._id })
        .sort({ dayId: 1, orderIndex: 1 })
        .exec(),
      this.budgetEntryModel
        .find({ itinerary: itinerary._id })
        .sort({ dayId: 1, createdAt: 1 })
        .exec(),
      this.transportCostModel
        .find({ itinerary: itinerary._id })
        .sort({ createdAt: 1 })
        .exec(),
    ]);
    const plain = itinerary.toObject();
    const days = [...plain.days]
      .sort((first, second) => first.dayNumber - second.dayNumber)
      .map((day) => ({
        ...day,
        activities: activities.filter(
          (activity) => String(activity.dayId) === String(day._id),
        ),
        budgetEntries: budgetEntries.filter(
          (entry) => String(entry.dayId) === String(day._id),
        ),
      }));
    return { ...plain, days, transportCosts };
  }

  private async findItineraryById(id: string): Promise<ItineraryDocument> {
    const itinerary = await this.itineraryModel
      .findById(this.objectId(id, 'id'))
      .exec();
    if (!itinerary) throw new NotFoundException('Itinerary not found');
    return itinerary;
  }

  private assertOwner(
    itinerary: ItineraryDocument,
    userId: string,
    allowAdmin = false,
  ): void {
    if (allowAdmin) return;
    if (String(itinerary.user) !== userId) {
      throw new ForbiddenException('You do not own this itinerary');
    }
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

  private sortOptions(
    sortBy?: string,
    sortOrder: 'asc' | 'desc' = 'desc',
  ): Record<string, 1 | -1> {
    const field = sortBy ?? 'createdAt';
    const allowedFields = new Set([
      'createdAt',
      'updatedAt',
      'startDate',
      'title',
      'cloneCount',
    ]);
    if (!allowedFields.has(field)) {
      throw new BadRequestException('Unsupported sortBy field');
    }
    return { [field]: sortOrder === 'asc' ? 1 : -1 };
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
