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
import { AttractionDocument } from '../reference-data/schemas/attraction.schema';
import { CityDocument } from '../reference-data/schemas/city.schema';
import { UploadsService } from '../uploads/uploads.service';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import {
  CreateActivityDto,
  CreateBudgetEntryDto,
  CreateItineraryDayDto,
  ListItinerariesQueryDto,
  ReorderItineraryDaysDto,
  UpdateActivityDto,
  UpdateBudgetEntryDto,
  UpdateItineraryDayDto,
  UpdateItineraryDto,
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

  private async findOwnedItinerary(
    id: string,
    userId: string,
  ): Promise<ItineraryDocument> {
    const itinerary = await this.findItineraryById(id);
    this.assertOwner(itinerary, userId);
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
