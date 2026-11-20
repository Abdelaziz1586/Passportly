import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  CreateHotelDto,
  HotelDetailsQueryDto,
  HotelPoliciesDto,
  HotelReservationsQueryDto,
  SearchHotelsDto,
  UpdateHotelDto,
} from './dto/hotel.dto';
import { HotelAccessService } from './hotel-access.service';
import {
  AvailableRoom,
  HotelInventoryService,
} from './hotel-inventory.service';
import { HotelReviewsService } from './hotel-reviews.service';
import {
  dateRange,
  escapeRegex,
  objectId,
  paged,
  pagination,
  PLATFORM_CURRENCY,
  utcDate,
} from './hotel-utils';
import { MediaItem } from '../../common/schemas/media-item.schema';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';
import { Hotel, HotelDocument } from './schemas/hotel.schema';
import { Review, ReviewDocument } from './schemas/review.schema';
import {
  RoomAvailability,
  RoomAvailabilityDocument,
} from './schemas/room-availability.schema';
import { Room, RoomDocument } from './schemas/room.schema';

@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name) readonly hotelModel: Model<HotelDocument>,
    @InjectModel(Room.name) readonly roomModel: Model<RoomDocument>,
    @InjectModel(RoomAvailability.name)
    readonly roomAvailabilityModel: Model<RoomAvailabilityDocument>,
    @InjectModel(HotelBooking.name)
    readonly hotelBookingModel: Model<HotelBookingDocument>,
    @InjectModel(Review.name) readonly reviewModel: Model<ReviewDocument>,
    private readonly reference: ReferenceDataService,
    private readonly access: HotelAccessService,
    private readonly inventory: HotelInventoryService,
    private readonly reviews: HotelReviewsService,
    private readonly uploads: UploadsService,
  ) {}

  async searchForCities(cityIds: string[]): Promise<HotelDocument[]> {
    if (cityIds.length === 0) return [];
    return this.hotelModel
      .find({
        city: { $in: cityIds.map((id) => new Types.ObjectId(id)) },
        isActive: true,
      })
      .sort({ averageRating: -1, reviewCount: -1 })
      .populate('city', 'name countryCode')
      .exec();
  }

  /** A room must have at least one free unit on every night of the stay. */
  async searchForStay(
    cityId: string,
    checkInDate: Date,
    checkOutDate: Date,
  ): Promise<HotelDocument[]> {
    const hotels = await this.searchForCities([cityId]);
    if (hotels.length === 0) return [];
    const rooms = await this.roomModel
      .find({
        hotel: { $in: hotels.map((hotel) => hotel._id) },
        isActive: true,
      })
      .select('_id hotel')
      .lean()
      .exec();
    const nights = Math.round(
      (checkOutDate.getTime() - checkInDate.getTime()) / 86_400_000,
    );
    if (rooms.length === 0 || nights < 1) return [];
    const availability = await this.roomAvailabilityModel
      .find({
        room: { $in: rooms.map((room) => room._id) },
        date: { $gte: checkInDate, $lt: checkOutDate },
        isBlocked: false,
        $expr: {
          $gt: ['$totalUnits', { $add: ['$bookedUnits', '$heldUnits'] }],
        },
      })
      .select('room date')
      .lean()
      .exec();
    const nightsByRoom = new Map<string, Set<number>>();
    for (const night of availability) {
      const roomId = String(night.room);
      const dates = nightsByRoom.get(roomId) ?? new Set<number>();
      dates.add(night.date.getTime());
      nightsByRoom.set(roomId, dates);
    }
    const availableHotelIds = new Set(
      rooms
        .filter((room) => nightsByRoom.get(String(room._id))?.size === nights)
        .map((room) => String(room.hotel)),
    );
    return hotels.filter((hotel) => availableHotelIds.has(String(hotel._id)));
  }

  async createHotel(dto: CreateHotelDto, user: AuthenticatedUser) {
    // The official workbook reserves provider creation for administrators (HTL-01).
    if (user.role !== Role.ADMIN)
      throw new ForbiddenException('Only administrators may create hotels');
    const location = await this.reference.hotelLocation(dto.city, dto.country);
    if (
      !(await this.reference.isCurrencySupported(
        dto.baseCurrency ?? PLATFORM_CURRENCY,
      ))
    )
      throw new BadRequestException('Unsupported currency');
    const images = dto.images
      ? await this.uploads.storedImages(dto.images)
      : [];
    return this.hotelModel.create({
      ...dto,
      ...location,
      baseCurrency: PLATFORM_CURRENCY,
      images,
    });
  }

  async updateHotel(id: string, dto: UpdateHotelDto, user: AuthenticatedUser) {
    const hotel = await this.access.managedHotel(id, user);
    if (!Object.values(dto).some((value) => value !== undefined))
      throw new BadRequestException('Provide at least one hotel field');
    const location =
      dto.city || dto.country
        ? await this.reference.hotelLocation(
            dto.city ?? hotel.city.toString(),
            dto.country,
          )
        : {};
    const images = dto.images
      ? await this.uploads.storedImages(dto.images)
      : undefined;
    return this.hotelModel
      .findByIdAndUpdate(
        hotel._id,
        { $set: { ...dto, ...location, ...(images ? { images } : {}) } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean();
  }

  async getHotel(id: string, query: HotelDetailsQueryDto) {
    const hotel = await this.access.hotel(id, true);
    if (!!query.checkInDate !== !!query.checkOutDate)
      throw new BadRequestException(
        'Provide both checkInDate and checkOutDate',
      );
    const rooms = await this.roomModel
      .find({ hotel: hotel._id, isActive: true })
      .select(
        'name roomType numberOfBeds bedConfiguration maxOccupancy maxAdults maxChildren basePricePerNight currency amenities images totalUnits',
      )
      .sort({ name: 1, _id: 1 })
      .lean();
    const summary = (await this.reviews.summaries([hotel._id])).get(
      hotel._id.toString(),
    )!;
    const reviewPage = await this.reviews.list(id, { page: 1, limit: 10 });
    const availableRooms =
      query.checkInDate && query.checkOutDate
        ? await this.inventory.getAvailableRooms(id, {
            checkInDate: query.checkInDate,
            checkOutDate: query.checkOutDate,
            guestCount: query.guestCount ?? 1,
          })
        : undefined;
    const { page, limit, skip } = pagination(query.page, query.limit);
    return {
      ...hotel,
      ...summary,
      rooms: paged(rooms.slice(skip, skip + limit), rooms.length, page, limit),
      reviews: reviewPage,
      ...(availableRooms ? { availableRooms } : {}),
    };
  }

  private qualifyingRooms(
    rooms: AvailableRoom[],
    roomCount: number,
    guestCount: number,
  ): AvailableRoom[] {
    const units = rooms.flatMap((room) =>
      Array.from(
        { length: Math.min(roomCount, room.minimumAvailableUnits) },
        () => ({ room, capacity: room.maxOccupancy }),
      ),
    );
    if (units.length < roomCount) return [];
    units.sort((a, b) => b.capacity - a.capacity);
    if (
      units.slice(0, roomCount).reduce((sum, unit) => sum + unit.capacity, 0) <
      guestCount
    )
      return [];
    // A room qualifies only if it can participate in an allocation of exactly roomCount units.
    return rooms.filter((room) => {
      const others = [...units];
      const index = others.findIndex((unit) => unit.room._id.equals(room._id));
      others.splice(index, 1);
      return (
        room.maxOccupancy +
          others
            .slice(0, roomCount - 1)
            .reduce((sum, unit) => sum + unit.capacity, 0) >=
        guestCount
      );
    });
  }

  async searchHotels(query: SearchHotelsDto) {
    const dates = dateRange(query.checkInDate, query.checkOutDate, true);
    if (!query.city && !query.country && !query.destination)
      throw new BadRequestException('Provide a city, country or destination');
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    )
      throw new BadRequestException('minPrice cannot exceed maxPrice');
    const sortBy = query.sortBy ?? 'price';
    if (!['price', 'rating', 'starRating', 'name'].includes(sortBy))
      throw new BadRequestException(
        'sortBy must be price, rating, starRating or name',
      );
    const filter: Record<string, unknown> = { isActive: true };
    if (query.city) filter.city = objectId(query.city, 'city');
    if (query.country) filter.country = objectId(query.country, 'country');
    if (query.starRating !== undefined) filter.starRating = query.starRating;
    if (query.amenities?.length) filter.amenities = { $all: query.amenities };
    if (query.destination) {
      const pattern = new RegExp(escapeRegex(query.destination), 'i');
      const countryIds = await this.reference.countryIdsMatching(pattern);
      filter.$or = [
        { cityName: pattern },
        { countryCode: pattern },
        { country: { $in: countryIds } },
      ];
    }
    const hotels = await this.hotelModel.find(filter).lean();
    const ratings = await this.reviews.summaries(
      hotels.map((hotel) => hotel._id),
    );
    const availableRooms = await this.inventory.availableRooms(
      hotels.map((hotel) => hotel._id),
      dates,
    );
    const data = hotels.flatMap((hotel) => {
      const summary = ratings.get(hotel._id.toString())!;
      if (
        query.minRating !== undefined &&
        (!summary.reviewCount || summary.averageRating < query.minRating)
      )
        return [];
      const rooms = this.qualifyingRooms(
        availableRooms.filter((room) => room.hotel.equals(hotel._id)),
        query.roomCount ?? 1,
        query.guestCount,
      );
      if (!rooms.length) return [];
      const pricePerNight = Math.min(
        ...rooms.map((room) => room.averagePricePerNight),
      );
      if (
        (query.minPrice !== undefined && pricePerNight < query.minPrice) ||
        (query.maxPrice !== undefined && pricePerNight > query.maxPrice)
      )
        return [];
      return [
        {
          ...hotel,
          ...summary,
          pricePerNight,
          currency: hotel.baseCurrency,
          nights: dates.length,
          availableRoomCount: rooms.reduce(
            (sum, room) => sum + room.minimumAvailableUnits,
            0,
          ),
          cheapestRoomStayPrice: Math.min(
            ...rooms.map((room) => room.totalStayPrice),
          ),
        },
      ];
    });
    const direction = query.sortOrder === 'asc' ? 1 : -1;
    data.sort((a, b) => {
      const comparison =
        sortBy === 'name'
          ? a.name.localeCompare(b.name)
          : sortBy === 'rating'
            ? a.averageRating - b.averageRating
            : sortBy === 'starRating'
              ? a.starRating - b.starRating
              : a.pricePerNight - b.pricePerNight;
      return (
        direction * comparison ||
        a._id.toString().localeCompare(b._id.toString())
      );
    });
    const { page, limit, skip } = pagination(query.page, query.limit);
    return paged(data.slice(skip, skip + limit), data.length, page, limit);
  }

  async updatePolicies(
    id: string,
    dto: HotelPoliciesDto,
    user: AuthenticatedUser,
  ) {
    const hotel = await this.access.managedHotel(id, user);
    return this.hotelModel
      .findByIdAndUpdate(
        hotel._id,
        { $set: { policies: dto } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean();
  }

  async getHotelReservations(
    id: string,
    query: HotelReservationsQueryDto,
    user: AuthenticatedUser,
  ) {
    const hotel = await this.access.managedHotel(id, user);
    const filter: Record<string, unknown> = { hotel: hotel._id };
    if (query.status) filter.status = query.status;
    if (query.startDate && query.endDate)
      dateRange(query.startDate, query.endDate);
    if (query.startDate)
      filter.checkOutDate = { $gt: utcDate(query.startDate) };
    if (query.endDate) filter.checkInDate = { $lt: utcDate(query.endDate) };
    const sortBy = query.sortBy ?? 'checkInDate';
    if (
      !['checkInDate', 'checkOutDate', 'createdAt', 'status'].includes(sortBy)
    )
      throw new BadRequestException('Unsupported reservation sort field');
    const { page, limit, skip } = pagination(query.page, query.limit);
    const data = await this.hotelBookingModel
      .find(filter)
      .select(
        'bookingReference user hotel rooms checkInDate checkOutDate nights guestCount primaryGuestName primaryGuestEmail primaryGuestPhone specialRequests totalPrice currency status confirmedAt cancelledAt createdAt',
      )
      .sort({ [sortBy]: query.sortOrder === 'asc' ? 1 : -1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean();
    const total = await this.hotelBookingModel.countDocuments(filter);
    return paged(data, total, page, limit);
  }

  async uploadImages(
    id: string,
    files: Express.Multer.File[],
    user: AuthenticatedUser,
  ) {
    await this.access.managedHotel(id, user);
    if (!files.length)
      throw new BadRequestException('Provide one or more images');
    const stored: MediaItem[] = [];
    try {
      for (const file of files)
        stored.push(await this.uploads.storeImage(file));
      const hotel = await this.hotelModel
        .findOneAndUpdate(
          {
            _id: objectId(id),
            $expr: {
              $lte: [
                {
                  $add: [
                    { $size: { $ifNull: ['$images', []] } },
                    stored.length,
                  ],
                },
                5,
              ],
            },
          },
          { $push: { images: { $each: stored } } },
          { returnDocument: 'after', runValidators: true },
        )
        .lean();
      if (!hotel)
        throw new ConflictException('A hotel may have at most five images');
      return hotel;
    } catch (error) {
      await this.uploads.discard(stored);
      throw error;
    }
  }
}
