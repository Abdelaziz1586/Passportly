import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { UploadsService } from '../uploads/uploads.service';
import { CreateHotelDto, SearchHotelsDto } from './dto/hotel.dto';
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
} from './hotel-utils';
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
}
