import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
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
import { firstValueFrom } from 'rxjs';
import {
  BudgetCategory,
  ItineraryVisibility,
  Role,
  TransportMode,
} from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import type { MediaItem } from '../../common/schemas/media-item.schema';
import { HotelsService } from '../hotels/hotels.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { AttractionDocument } from '../reference-data/schemas/attraction.schema';
import { CityDocument } from '../reference-data/schemas/city.schema';
import { UploadsService } from '../uploads/uploads.service';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import {
  BudgetSummaryQueryDto,
  CreateActivityDto,
  CreateBudgetEntryDto,
  CreateItineraryDayDto,
  CreateTransportCostDto,
  ItineraryContextSearchQueryDto,
  ListItinerariesQueryDto,
  PublicItinerarySearchQueryDto,
  ReorderItineraryDaysDto,
  UpdateActivityDto,
  UpdateBudgetEntryDto,
  UpdateItineraryDayDto,
  UpdateItineraryDto,
  UpdateTransportCostDto,
} from './dto/itinerary-endpoints.dto';
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

interface FxRatesApiResponse {
  success?: boolean;
  base?: string;
  rates?: Record<string, number>;
}

export interface BudgetSummaryLine {
  type: 'BUDGET_ENTRY' | 'TRANSPORT_COST';
  category: BudgetCategory | 'TRANSPORT';
  title: string;
  originalAmount: number;
  originalCurrency: string;
  convertedAmount: number;
}

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
    readonly hotelsService: HotelsService,
    readonly uploadsService: UploadsService,
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

  async updateItinerary(
    id: string,
    userId: string,
    dto: UpdateItineraryDto,
  ): Promise<ItineraryDocument> {
    const itinerary = await this.findOwnedItinerary(id, userId);

    if (typeof dto.title === 'string') {
      const title = dto.title.trim();
      if (!title) throw new BadRequestException('title must not be empty');
      itinerary.title = title;
    }
    if (typeof dto.description === 'string') {
      itinerary.description = dto.description.trim() || undefined;
    }
    if (Array.isArray(dto.countries)) {
      itinerary.countries = await this.validateCountryIds(dto.countries);
    }
    if (typeof dto.displayCurrency === 'string') {
      const currency = dto.displayCurrency.trim().toUpperCase();
      await this.assertSupportedCurrency(currency);
      itinerary.displayCurrency = currency;
    }
    if (typeof dto.startDate === 'string') {
      itinerary.startDate = this.parseDate(dto.startDate, 'startDate');
      this.recalculateDayDates(itinerary);
    }
    if (dto.visibility) itinerary.visibility = dto.visibility;

    return this.saveItinerary(itinerary);
  }

  async deleteItinerary(id: string, userId: string) {
    const itinerary = await this.findOwnedItinerary(id, userId);
    const itineraryId = itinerary._id;
    await this.itineraryModel.db.transaction(async (session) => {
      await this.activityModel
        .deleteMany({ itinerary: itineraryId })
        .session(session)
        .exec();
      await this.budgetEntryModel
        .deleteMany({ itinerary: itineraryId })
        .session(session)
        .exec();
      await this.transportCostModel
        .deleteMany({ itinerary: itineraryId })
        .session(session)
        .exec();
      await itinerary.deleteOne({ session });
    });
    return { deleted: true, itineraryId: String(itineraryId) };
  }

  async addDay(id: string, userId: string, dto: CreateItineraryDayDto) {
    const itinerary = await this.findOwnedItinerary(id, userId);
    const city = dto.cityId ? await this.findCity(dto.cityId) : undefined;
    const dayNumber = itinerary.days.length + 1;
    itinerary.days.push({
      dayNumber,
      date: this.addUtcDays(itinerary.startDate, dayNumber - 1),
      ...(city ? { city: city._id } : {}),
      ...(dto.cityName?.trim()
        ? { cityName: dto.cityName.trim() }
        : city
          ? { cityName: city.name }
          : {}),
      ...(dto.title?.trim() ? { title: dto.title.trim() } : {}),
      ...(dto.notes?.trim() ? { notes: dto.notes.trim() } : {}),
    });
    const saved = await this.saveItinerary(itinerary);
    return saved.days[saved.days.length - 1];
  }

  async updateDay(
    id: string,
    dayId: string,
    userId: string,
    dto: UpdateItineraryDayDto,
  ) {
    const itinerary = await this.findOwnedItinerary(id, userId);
    const day = this.findDay(itinerary, dayId);
    if (typeof dto.cityId === 'string') {
      const city = await this.findCity(dto.cityId);
      day.city = city._id;
      if (typeof dto.cityName !== 'string') day.cityName = city.name;
    }
    if (typeof dto.cityName === 'string') day.cityName = dto.cityName.trim();
    if (typeof dto.title === 'string') day.title = dto.title.trim();
    if (typeof dto.notes === 'string') day.notes = dto.notes.trim();
    const saved = await this.saveItinerary(itinerary);
    return saved.days.find(
      (savedDay) => String(savedDay._id) === String(day._id),
    );
  }

  async deleteDay(id: string, dayId: string, userId: string) {
    await this.itineraryModel.db.transaction(async (session) => {
      const itinerary = await this.itineraryModel
        .findById(this.objectId(id, 'id'))
        .session(session)
        .exec();
      if (!itinerary) throw new NotFoundException('Itinerary not found');
      this.assertOwner(itinerary, userId);
      const day = this.findDay(itinerary, dayId);
      await this.activityModel
        .deleteMany({ itinerary: itinerary._id, dayId: day._id })
        .session(session)
        .exec();
      await this.budgetEntryModel
        .deleteMany({ itinerary: itinerary._id, dayId: day._id })
        .session(session)
        .exec();
      await this.transportCostModel
        .updateMany(
          { itinerary: itinerary._id, departureDayId: day._id },
          { $set: { departureDayId: null } },
        )
        .session(session)
        .exec();
      const dayIndex = itinerary.days.findIndex(
        (currentDay) => String(currentDay._id) === String(day._id),
      );
      itinerary.days.splice(dayIndex, 1);
      this.recalculateDayDates(itinerary);
      await this.saveItinerary(itinerary, session);
    });
    return { deleted: true, dayId };
  }

  async reorderDays(
    id: string,
    userId: string,
    dto: ReorderItineraryDaysDto,
  ): Promise<ItineraryDocument> {
    const itinerary = await this.findOwnedItinerary(id, userId);
    const dayIds = dto.dayIds.map((dayId) =>
      String(this.objectId(dayId, 'dayIds')),
    );
    if (dayIds.length !== itinerary.days.length) {
      throw new BadRequestException(
        'dayIds must include every itinerary day exactly once',
      );
    }
    if (new Set(dayIds).size !== dayIds.length) {
      throw new BadRequestException('dayIds must not contain duplicates');
    }
    const daysById = new Map(
      itinerary.days.map((day) => [String(day._id), day]),
    );
    const orderedDays = dayIds.map((dayId) => {
      const day = daysById.get(dayId);
      if (!day) {
        throw new BadRequestException(
          'dayIds must include every itinerary day exactly once',
        );
      }
      return day;
    });
    itinerary.days = orderedDays;
    this.recalculateDayDates(itinerary);
    return this.saveItinerary(itinerary);
  }

  async addActivity(
    itineraryId: string,
    dayId: string,
    userId: string,
    dto: CreateActivityDto,
  ): Promise<ActivityDocument> {
    const itinerary = await this.findOwnedItinerary(itineraryId, userId);
    const day = this.findDay(itinerary, dayId);
    const attraction = dto.attractionId
      ? await this.findAttraction(dto.attractionId)
      : undefined;
    this.assertValidTimeRange(dto.startTime, dto.endTime);
    const orderIndex =
      dto.orderIndex ??
      (await this.activityModel
        .countDocuments({ itinerary: itinerary._id, dayId: day._id })
        .exec());

    return this.activityModel.create({
      itinerary: itinerary._id,
      dayId: day._id,
      user: this.objectId(userId, 'userId'),
      title: dto.title.trim(),
      ...(dto.description?.trim()
        ? { description: dto.description.trim() }
        : {}),
      ...(dto.category?.trim() ? { category: dto.category.trim() } : {}),
      ...(attraction ? { attraction: attraction._id } : {}),
      ...(dto.locationName?.trim()
        ? { locationName: dto.locationName.trim() }
        : {}),
      ...(dto.startTime ? { startTime: dto.startTime } : {}),
      ...(dto.endTime ? { endTime: dto.endTime } : {}),
      orderIndex,
    });
  }

  async updateActivity(
    id: string,
    userId: string,
    dto: UpdateActivityDto,
  ): Promise<ActivityDocument> {
    const activity = await this.findOwnedActivity(id, userId);
    if (typeof dto.title === 'string') {
      const title = dto.title.trim();
      if (!title) throw new BadRequestException('title must not be empty');
      activity.title = title;
    }
    if (typeof dto.description === 'string') {
      activity.description = dto.description.trim() || undefined;
    }
    if (typeof dto.category === 'string') {
      activity.category = dto.category.trim() || undefined;
    }
    if (typeof dto.attractionId === 'string') {
      const attraction = await this.findAttraction(dto.attractionId);
      activity.attraction = attraction._id;
    }
    if (typeof dto.locationName === 'string') {
      activity.locationName = dto.locationName.trim() || undefined;
    }
    if (typeof dto.startTime === 'string') activity.startTime = dto.startTime;
    if (typeof dto.endTime === 'string') activity.endTime = dto.endTime;
    if (typeof dto.orderIndex === 'number')
      activity.orderIndex = dto.orderIndex;
    this.assertValidTimeRange(activity.startTime, activity.endTime);
    return activity.save();
  }

  async deleteActivity(id: string, userId: string) {
    const activity = await this.findOwnedActivity(id, userId);
    await activity.deleteOne();
    return { deleted: true, activityId: id };
  }

  async uploadActivityImage(
    id: string,
    userId: string,
    file: Express.Multer.File,
  ) {
    const activity = await this.findOwnedActivity(id, userId);
    const image = await this.uploadsService.saveImage(file);
    activity.images.push(image);
    try {
      await activity.save();
    } catch (error: unknown) {
      await this.uploadsService
        .removeImage(image.filename)
        .catch(() => undefined);
      throw error;
    }
    return activity.images.find(
      (savedImage) => savedImage.filename === image.filename,
    );
  }

  async deleteActivityImage(id: string, imageId: string, userId: string) {
    const activity = await this.findOwnedActivity(id, userId);
    const imageObjectId = this.objectId(imageId, 'imageId');
    const index = activity.images.findIndex(
      (image) => String(image._id) === String(imageObjectId),
    );
    if (index < 0) throw new NotFoundException('Activity image not found');
    const [image] = activity.images.splice(index, 1);
    await activity.save();
    await this.uploadsService
      .removeImage(image.filename)
      .catch(() => undefined);
    return { deleted: true, imageId };
  }

  async addBudgetEntry(
    itineraryId: string,
    dayId: string,
    userId: string,
    dto: CreateBudgetEntryDto,
  ): Promise<BudgetEntryDocument> {
    const itinerary = await this.findOwnedItinerary(itineraryId, userId);
    const day = this.findDay(itinerary, dayId);
    const currency = dto.currency.trim().toUpperCase();
    await this.assertSupportedCurrency(currency);
    return this.budgetEntryModel.create({
      itinerary: itinerary._id,
      dayId: day._id,
      user: this.objectId(userId, 'userId'),
      category: dto.category,
      title: dto.title.trim(),
      ...(dto.notes?.trim() ? { notes: dto.notes.trim() } : {}),
      amount: dto.amount,
      currency,
    });
  }

  async updateBudgetEntry(
    id: string,
    userId: string,
    dto: UpdateBudgetEntryDto,
  ): Promise<BudgetEntryDocument> {
    const entry = await this.findOwnedBudgetEntry(id, userId);
    if (dto.category) entry.category = dto.category;
    if (typeof dto.title === 'string') {
      const title = dto.title.trim();
      if (!title) throw new BadRequestException('title must not be empty');
      entry.title = title;
    }
    if (typeof dto.notes === 'string')
      entry.notes = dto.notes.trim() || undefined;
    if (typeof dto.amount === 'number') entry.amount = dto.amount;
    if (typeof dto.currency === 'string') {
      const currency = dto.currency.trim().toUpperCase();
      await this.assertSupportedCurrency(currency);
      entry.currency = currency;
    }
    return entry.save();
  }

  async deleteBudgetEntry(id: string, userId: string) {
    const entry = await this.findOwnedBudgetEntry(id, userId);
    await entry.deleteOne();
    return { deleted: true, budgetEntryId: id };
  }

  async addTransportCost(
    itineraryId: string,
    userId: string,
    dto: CreateTransportCostDto,
  ): Promise<TransportCostDocument> {
    const itinerary = await this.findOwnedItinerary(itineraryId, userId);
    const fromCity = dto.fromCityId
      ? await this.findCity(dto.fromCityId)
      : undefined;
    const toCity = dto.toCityId ? await this.findCity(dto.toCityId) : undefined;
    const departureDay = dto.departureDayId
      ? this.findDay(itinerary, dto.departureDayId)
      : undefined;
    const currency = dto.currency.trim().toUpperCase();
    await this.assertSupportedCurrency(currency);
    return this.transportCostModel.create({
      itinerary: itinerary._id,
      user: this.objectId(userId, 'userId'),
      ...(fromCity ? { fromCity: fromCity._id } : {}),
      ...(toCity ? { toCity: toCity._id } : {}),
      ...(dto.fromCityName?.trim()
        ? { fromCityName: dto.fromCityName.trim() }
        : fromCity
          ? { fromCityName: fromCity.name }
          : {}),
      ...(dto.toCityName?.trim()
        ? { toCityName: dto.toCityName.trim() }
        : toCity
          ? { toCityName: toCity.name }
          : {}),
      mode: dto.mode ?? TransportMode.OTHER,
      ...(departureDay ? { departureDayId: departureDay._id } : {}),
      amount: dto.amount,
      currency,
      ...(dto.notes?.trim() ? { notes: dto.notes.trim() } : {}),
    });
  }

  async updateTransportCost(
    id: string,
    userId: string,
    dto: UpdateTransportCostDto,
  ): Promise<TransportCostDocument> {
    const cost = await this.findOwnedTransportCost(id, userId);
    if (dto.mode) cost.mode = dto.mode;
    if (typeof dto.amount === 'number') cost.amount = dto.amount;
    if (typeof dto.currency === 'string') {
      const currency = dto.currency.trim().toUpperCase();
      await this.assertSupportedCurrency(currency);
      cost.currency = currency;
    }
    if (typeof dto.fromCityId === 'string') {
      const city = await this.findCity(dto.fromCityId);
      cost.fromCity = city._id;
      if (typeof dto.fromCityName !== 'string') cost.fromCityName = city.name;
    }
    if (typeof dto.toCityId === 'string') {
      const city = await this.findCity(dto.toCityId);
      cost.toCity = city._id;
      if (typeof dto.toCityName !== 'string') cost.toCityName = city.name;
    }
    if (typeof dto.fromCityName === 'string') {
      cost.fromCityName = dto.fromCityName.trim() || undefined;
    }
    if (typeof dto.toCityName === 'string') {
      cost.toCityName = dto.toCityName.trim() || undefined;
    }
    if (typeof dto.departureDayId === 'string') {
      const itinerary = await this.findItineraryById(String(cost.itinerary));
      const day = this.findDay(itinerary, dto.departureDayId);
      cost.departureDayId = day._id;
    }
    if (typeof dto.notes === 'string')
      cost.notes = dto.notes.trim() || undefined;
    return cost.save();
  }

  async deleteTransportCost(id: string, userId: string) {
    const cost = await this.findOwnedTransportCost(id, userId);
    await cost.deleteOne();
    return { deleted: true, transportCostId: id };
  }

  async getBudgetSummary(
    id: string,
    query: BudgetSummaryQueryDto,
    user?: AuthenticatedUser,
  ) {
    const itinerary = await this.findVisibleOrOwnedItinerary(id, user);
    const targetCurrency = (query.currency ?? itinerary.displayCurrency)
      .trim()
      .toUpperCase();
    await this.assertSupportedCurrency(targetCurrency);
    const [budgetEntries, transportCosts] = await Promise.all([
      this.budgetEntryModel.find({ itinerary: itinerary._id }).exec(),
      this.transportCostModel.find({ itinerary: itinerary._id }).exec(),
    ]);

    const sourceCurrencies = Array.from(
      new Set([
        ...budgetEntries.map((entry) => entry.currency),
        ...transportCosts.map((cost) => cost.currency),
      ]),
    );
    await Promise.all(
      sourceCurrencies.map((currency) =>
        this.assertSupportedCurrency(currency),
      ),
    );
    const rates = new Map<string, number>();
    await Promise.all(
      sourceCurrencies.map(async (currency) => {
        rates.set(
          currency,
          await this.getExchangeRate(currency, targetCurrency),
        );
      }),
    );

    const lines: BudgetSummaryLine[] = [
      ...budgetEntries.map((entry) => ({
        type: 'BUDGET_ENTRY' as const,
        category: entry.category,
        title: entry.title,
        originalAmount: entry.amount,
        originalCurrency: entry.currency,
        convertedAmount: this.roundCurrency(
          entry.amount * (rates.get(entry.currency) ?? 1),
        ),
      })),
      ...transportCosts.map((cost) => ({
        type: 'TRANSPORT_COST' as const,
        category: 'TRANSPORT' as const,
        title:
          cost.notes ||
          [cost.fromCityName, cost.toCityName].filter(Boolean).join(' → ') ||
          'Transport',
        originalAmount: cost.amount,
        originalCurrency: cost.currency,
        convertedAmount: this.roundCurrency(
          cost.amount * (rates.get(cost.currency) ?? 1),
        ),
      })),
    ];
    const totalsByCategory = new Map<string, number>();
    for (const line of lines) {
      totalsByCategory.set(
        line.category,
        this.roundCurrency(
          (totalsByCategory.get(line.category) ?? 0) + line.convertedAmount,
        ),
      );
    }
    const total = this.roundCurrency(
      lines.reduce((sum, line) => sum + line.convertedAmount, 0),
    );
    return {
      itineraryId: String(itinerary._id),
      currency: targetCurrency,
      totalsByCategory: Object.fromEntries(totalsByCategory),
      total,
      entries: lines,
    };
  }

  async searchPublicItineraries(query: PublicItinerarySearchQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter: QueryFilter<ItineraryDocument> = {
      visibility: ItineraryVisibility.PUBLIC,
      isHidden: false,
    };
    if (query.search?.trim()) {
      const search = new RegExp(this.escapeRegex(query.search.trim()), 'i');
      filter.$or = [{ title: search }, { description: search }];
    }
    if (query.countryId) {
      filter.countries = this.objectId(query.countryId, 'countryId');
    }
    if (
      query.minDays !== undefined &&
      query.maxDays !== undefined &&
      query.minDays > query.maxDays
    ) {
      throw new BadRequestException('minDays must not exceed maxDays');
    }
    const durationConstraints: Record<string, unknown>[] = [];
    if (query.minDays !== undefined) {
      durationConstraints.push({
        $gte: [{ $size: { $ifNull: ['$days', []] } }, query.minDays],
      });
    }
    if (query.maxDays !== undefined) {
      durationConstraints.push({
        $lte: [{ $size: { $ifNull: ['$days', []] } }, query.maxDays],
      });
    }
    if (durationConstraints.length > 0) {
      filter.$expr = { $and: durationConstraints };
    }

    const [items, total] = await Promise.all([
      this.itineraryModel
        .find(filter)
        .populate('user', 'firstName lastName avatarUrl')
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

  async getPublicItinerary(id: string): Promise<Record<string, unknown>> {
    const itinerary = await this.findItineraryById(id);
    if (
      itinerary.visibility !== ItineraryVisibility.PUBLIC ||
      itinerary.isHidden
    ) {
      throw new NotFoundException('Public itinerary not found');
    }
    await itinerary.populate({
      path: 'user',
      select: 'firstName lastName avatarUrl',
    });
    return this.getItineraryDetails(itinerary);
  }

  async cloneItinerary(id: string, userId: string) {
    const source = await this.findItineraryById(id);
    if (source.visibility !== ItineraryVisibility.PUBLIC || source.isHidden) {
      throw new NotFoundException('Public itinerary not found');
    }

    const sourcePlain = source.toObject();
    const clone = await this.itineraryModel.create({
      user: this.objectId(userId, 'userId'),
      title: `${source.title} (Copy)`,
      description: source.description,
      countries: source.countries,
      startDate: source.startDate,
      displayCurrency: source.displayCurrency,
      visibility: ItineraryVisibility.PRIVATE,
      isHidden: false,
      days: sourcePlain.days.map((day) => ({
        dayNumber: day.dayNumber,
        date: day.date,
        city: day.city ?? null,
        cityName: day.cityName,
        title: day.title,
        notes: day.notes,
      })),
      clonedFromItinerary: source._id,
      clonedFromUser: source.user,
      coverImageUrl: source.coverImageUrl,
      cloneCount: 0,
    });

    const dayIdMap = new Map<string, Types.ObjectId>();
    sourcePlain.days.forEach((day, index) => {
      const cloneDay = clone.days[index];
      if (day._id && cloneDay?._id) {
        dayIdMap.set(String(day._id), cloneDay._id);
      }
    });

    const copiedImages: MediaItem[] = [];
    try {
      const [activities, budgetEntries, transportCosts] = await Promise.all([
        this.activityModel.find({ itinerary: source._id }).lean().exec(),
        this.budgetEntryModel.find({ itinerary: source._id }).lean().exec(),
        this.transportCostModel.find({ itinerary: source._id }).lean().exec(),
      ]);
      const clonedActivities = [] as Array<{
        itinerary: Types.ObjectId;
        dayId: Types.ObjectId;
        user: Types.ObjectId;
        title: string;
        description?: string;
        category?: string;
        attraction?: Types.ObjectId | null;
        locationName?: string;
        startTime?: string;
        endTime?: string;
        orderIndex: number;
        images: MediaItem[];
      }>;
      for (const activity of activities) {
        const dayId = dayIdMap.get(String(activity.dayId));
        if (!dayId) continue;
        const images: MediaItem[] = [];
        for (const image of activity.images) {
          const copy = await this.uploadsService.copyImage(image);
          copiedImages.push(copy);
          images.push(copy);
        }
        clonedActivities.push({
          itinerary: clone._id,
          dayId,
          user: clone.user,
          title: activity.title,
          description: activity.description,
          category: activity.category,
          attraction: activity.attraction,
          locationName: activity.locationName,
          startTime: activity.startTime,
          endTime: activity.endTime,
          orderIndex: activity.orderIndex,
          images,
        });
      }
      const clonedBudgets = budgetEntries.flatMap((entry) => {
        const dayId = dayIdMap.get(String(entry.dayId));
        if (!dayId) return [];
        return [
          {
            itinerary: clone._id,
            dayId,
            user: clone.user,
            category: entry.category,
            title: entry.title,
            notes: entry.notes,
            amount: entry.amount,
            currency: entry.currency,
          },
        ];
      });
      const clonedTransportCosts = transportCosts.map((cost) => ({
        itinerary: clone._id,
        user: clone.user,
        fromCity: cost.fromCity,
        toCity: cost.toCity,
        fromCityName: cost.fromCityName,
        toCityName: cost.toCityName,
        mode: cost.mode,
        departureDayId: cost.departureDayId
          ? (dayIdMap.get(String(cost.departureDayId)) ?? null)
          : null,
        amount: cost.amount,
        currency: cost.currency,
        notes: cost.notes,
      }));

      if (clonedActivities.length) {
        await this.activityModel.insertMany(clonedActivities);
      }
      if (clonedBudgets.length) {
        await this.budgetEntryModel.insertMany(clonedBudgets);
      }
      if (clonedTransportCosts.length) {
        await this.transportCostModel.insertMany(clonedTransportCosts);
      }
      await this.itineraryModel
        .updateOne({ _id: source._id }, { $inc: { cloneCount: 1 } })
        .exec();
    } catch (error: unknown) {
      await Promise.allSettled([
        this.activityModel.deleteMany({ itinerary: clone._id }).exec(),
        this.budgetEntryModel.deleteMany({ itinerary: clone._id }).exec(),
        this.transportCostModel.deleteMany({ itinerary: clone._id }).exec(),
        clone.deleteOne(),
        ...copiedImages.map((image) =>
          this.uploadsService.removeImage(image.filename),
        ),
      ]);
      throw error;
    }

    return this.getItineraryDetails(clone);
  }

  async searchHotelsForItinerary(
    id: string,
    userId: string,
    query: ItineraryContextSearchQueryDto,
  ) {
    const itinerary = await this.findOwnedItinerary(id, userId);
    const days = this.selectDays(itinerary, query);
    const cityIds = Array.from(
      new Set(
        days
          .map((day) => day.city)
          .filter((city): city is Types.ObjectId => Boolean(city))
          .map((city) => String(city)),
      ),
    );
    const stays: Array<{
      cityId: string;
      cityName?: string;
      checkInDate: Date;
      checkOutDate: Date;
      startDay: number;
      endDay: number;
    }> = [];
    for (const day of days) {
      if (!day.city) continue;
      const cityId = String(day.city);
      const previousStay = stays[stays.length - 1];
      if (
        previousStay?.cityId === cityId &&
        previousStay.endDay + 1 === day.dayNumber
      ) {
        previousStay.endDay = day.dayNumber;
        previousStay.checkOutDate = this.addUtcDays(day.date, 1);
        if (day.cityName) previousStay.cityName = day.cityName;
        continue;
      }
      stays.push({
        cityId,
        ...(day.cityName ? { cityName: day.cityName } : {}),
        checkInDate: day.date,
        checkOutDate: this.addUtcDays(day.date, 1),
        startDay: day.dayNumber,
        endDay: day.dayNumber,
      });
    }
    const suggestions = await Promise.all(
      stays.map(async (stay) => ({
        ...stay,
        hotels: await this.hotelsService.searchForStay(
          stay.cityId,
          stay.checkInDate,
          stay.checkOutDate,
        ),
      })),
    );
    return { itineraryId: String(itinerary._id), cityIds, stays: suggestions };
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

  private async getExchangeRate(
    baseCurrency: string,
    targetCurrency: string,
  ): Promise<number> {
    if (baseCurrency === targetCurrency) return 1;
    const now = new Date();
    const cachedRate = await this.exchangeRateModel
      .findOne({
        baseCurrency,
        targetCurrency,
        expiresAt: { $gt: now },
      })
      .exec();
    if (cachedRate && Number.isFinite(cachedRate.rate) && cachedRate.rate > 0)
      return cachedRate.rate;

    const apiKey = this.configService.get<string>('fxRates.apiKey', '');
    const baseUrl = this.configService
      .get<string>('fxRates.baseUrl', 'https://api.fxratesapi.com')
      .replace(/\/+$/, '');
    if (!apiKey || !baseUrl) {
      throw new ServiceUnavailableException(
        'Currency conversion is not configured',
      );
    }

    let rate: number;
    try {
      const response = await firstValueFrom(
        this.httpService.get<FxRatesApiResponse>(`${baseUrl}/latest`, {
          timeout: 10_000,
          params: {
            api_key: apiKey,
            base: baseCurrency,
            currencies: targetCurrency,
            format: 'json',
          },
        }),
      );
      const receivedRate = response.data.rates?.[targetCurrency];
      if (
        response.data.success === false ||
        response.data.base !== baseCurrency ||
        typeof receivedRate !== 'number' ||
        !Number.isFinite(receivedRate) ||
        receivedRate <= 0
      ) {
        throw new Error('FXRatesAPI returned no usable rate');
      }
      rate = receivedRate;
    } catch {
      throw new ServiceUnavailableException(
        'Unable to retrieve exchange rates at this time',
      );
    }

    const fetchedAt = new Date();
    const expiresAt = new Date(fetchedAt.getTime() + 60_000);
    const savedRate = await this.exchangeRateModel
      .findOneAndUpdate(
        { baseCurrency, targetCurrency },
        { $set: { rate, fetchedAt, expiresAt, source: 'FXRatesAPI' } },
        { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
    if (!savedRate) {
      throw new ServiceUnavailableException(
        'Unable to cache exchange rates at this time',
      );
    }
    return savedRate.rate;
  }

  private async findItineraryById(id: string): Promise<ItineraryDocument> {
    const itinerary = await this.itineraryModel
      .findById(this.objectId(id, 'id'))
      .exec();
    if (!itinerary) throw new NotFoundException('Itinerary not found');
    return itinerary;
  }

  private async findOwnedItinerary(
    id: string,
    userId: string,
  ): Promise<ItineraryDocument> {
    const itinerary = await this.findItineraryById(id);
    this.assertOwner(itinerary, userId);
    return itinerary;
  }

  private async findVisibleOrOwnedItinerary(
    id: string,
    user?: AuthenticatedUser,
  ): Promise<ItineraryDocument> {
    const itinerary = await this.findItineraryById(id);
    if (
      itinerary.visibility === ItineraryVisibility.PUBLIC &&
      !itinerary.isHidden
    ) {
      return itinerary;
    }
    if (
      user &&
      (user.role === Role.ADMIN || String(itinerary.user) === user.userId)
    ) {
      return itinerary;
    }
    throw new NotFoundException('Itinerary not found');
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

  private async findOwnedActivity(
    id: string,
    userId: string,
  ): Promise<ActivityDocument> {
    const activity = await this.activityModel
      .findById(this.objectId(id, 'id'))
      .exec();
    if (!activity) throw new NotFoundException('Activity not found');
    if (String(activity.user) !== userId) {
      throw new ForbiddenException('You do not own this activity');
    }
    return activity;
  }

  private async findOwnedBudgetEntry(
    id: string,
    userId: string,
  ): Promise<BudgetEntryDocument> {
    const entry = await this.budgetEntryModel
      .findById(this.objectId(id, 'id'))
      .exec();
    if (!entry) throw new NotFoundException('Budget entry not found');
    if (String(entry.user) !== userId) {
      throw new ForbiddenException('You do not own this budget entry');
    }
    return entry;
  }

  private async findOwnedTransportCost(
    id: string,
    userId: string,
  ): Promise<TransportCostDocument> {
    const cost = await this.transportCostModel
      .findById(this.objectId(id, 'id'))
      .exec();
    if (!cost) throw new NotFoundException('Transport cost not found');
    if (String(cost.user) !== userId) {
      throw new ForbiddenException('You do not own this transport cost');
    }
    return cost;
  }

  private findDay(itinerary: ItineraryDocument, dayId: string) {
    const dayObjectId = this.objectId(dayId, 'dayId');
    const day = itinerary.days.find(
      (currentDay) => String(currentDay._id) === String(dayObjectId),
    );
    if (!day) throw new NotFoundException('Itinerary day not found');
    return day;
  }

  private async findCity(id: string): Promise<CityDocument> {
    const city = await this.referenceDataService.cityModel
      .findById(this.objectId(id, 'cityId'))
      .exec();
    if (!city) throw new BadRequestException('cityId is not a valid city');
    return city;
  }

  private async findAttraction(id: string): Promise<AttractionDocument> {
    const attraction = await this.referenceDataService.attractionModel
      .findById(this.objectId(id, 'attractionId'))
      .exec();
    if (!attraction) {
      throw new BadRequestException('attractionId is not a valid attraction');
    }
    return attraction;
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

  private addUtcDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setUTCHours(0, 0, 0, 0);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
  }

  private recalculateDayDates(itinerary: ItineraryDocument): void {
    for (const [index, day] of itinerary.days.entries()) {
      day.dayNumber = index + 1;
      day.date = this.addUtcDays(itinerary.startDate, index);
    }
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

  private assertValidTimeRange(startTime?: string, endTime?: string): void {
    if (startTime && endTime && startTime > endTime) {
      throw new BadRequestException('endTime must be after startTime');
    }
  }

  private selectDays(
    itinerary: ItineraryDocument,
    query: ItineraryContextSearchQueryDto,
  ) {
    if (
      query.startDay !== undefined &&
      query.endDay !== undefined &&
      query.startDay > query.endDay
    ) {
      throw new BadRequestException('startDay must not exceed endDay');
    }
    return [...itinerary.days]
      .filter((day) => {
        if (query.startDay !== undefined && day.dayNumber < query.startDay) {
          return false;
        }
        if (query.endDay !== undefined && day.dayNumber > query.endDay) {
          return false;
        }
        return true;
      })
      .sort((first, second) => first.dayNumber - second.dayNumber);
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

  private roundCurrency(amount: number): number {
    return Math.round((amount + Number.EPSILON) * 100) / 100;
  }
}
