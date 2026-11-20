import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { UploadsService } from '../uploads/uploads.service';
import { CreateRoomDto, StayQueryDto } from './dto/hotel.dto';
import { HotelAccessService } from './hotel-access.service';
import {
  dateRange,
  isDuplicateKey,
  money,
  paged,
  pagination,
} from './hotel-utils';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';
import { Room, RoomDocument } from './schemas/room.schema';
import {
  RoomAvailability,
  RoomAvailabilityDocument,
} from './schemas/room-availability.schema';

export interface AvailableRoom extends Room {
  _id: Types.ObjectId;
  minimumAvailableUnits: number;
  nights: number;
  averagePricePerNight: number;
  totalStayPrice: number;
  nightlyPrices: { date: string; price: number }[];
}

@Injectable()
export class HotelInventoryService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Room.name) private readonly rooms: Model<RoomDocument>,
    @InjectModel(RoomAvailability.name)
    private readonly availability: Model<RoomAvailabilityDocument>,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
    private readonly access: HotelAccessService,
    private readonly uploads: UploadsService,
  ) {}

  private validateRoomCapacity(
    room: Pick<Room, 'maxOccupancy' | 'maxAdults' | 'maxChildren'>,
  ): void {
    if (
      (room.maxAdults ?? 1) > room.maxOccupancy ||
      (room.maxChildren ?? 0) > room.maxOccupancy
    ) {
      throw new BadRequestException(
        'Adult and child capacity cannot exceed maxOccupancy',
      );
    }
  }

  async createRoom(
    hotelId: string,
    dto: CreateRoomDto,
    user: AuthenticatedUser,
  ) {
    const hotel = await this.access.managedHotel(hotelId, user);
    this.validateRoomCapacity(dto);
    if (dto.currency && dto.currency !== hotel.baseCurrency)
      throw new BadRequestException(
        'Room currency must match the hotel currency',
      );
    const images = dto.images
      ? await this.uploads.storedImages(dto.images)
      : [];
    try {
      return await this.rooms.create({
        ...dto,
        hotel: hotel._id,
        currency: hotel.baseCurrency,
        images,
      });
    } catch (error) {
      if (isDuplicateKey(error))
        throw new ConflictException(
          'Room name must be unique within this hotel',
        );
      throw error;
    }
  }

  /** Missing calendar rows are unavailable; overrides are summed once per stay night. */
  async availableRooms(
    hotelIds: Types.ObjectId[],
    dates: Date[],
  ): Promise<AvailableRoom[]> {
    if (!hotelIds.length) return [];
    const rooms = await this.rooms
      .find({ hotel: { $in: hotelIds }, isActive: true })
      .lean();
    const rows = await this.availability
      .find({
        room: { $in: rooms.map((room) => room._id) },
        date: { $in: dates },
      })
      .lean();
    const byRoom = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.room.toString();
      const group = byRoom.get(key) ?? [];
      group.push(row);
      byRoom.set(key, group);
    }
    const result: AvailableRoom[] = [];
    for (const room of rooms) {
      const nights = byRoom.get(room._id.toString()) ?? [];
      if (
        nights.length !== dates.length ||
        nights.some((night) => night.isBlocked)
      )
        continue;
      const minimumAvailableUnits = Math.min(
        ...nights.map(
          (night) => night.totalUnits - night.bookedUnits - night.heldUnits,
        ),
      );
      if (minimumAvailableUnits < 1) continue;
      const nightlyPrices = nights
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .map((night) => ({
          date: night.date.toISOString().slice(0, 10),
          price: night.priceOverride ?? room.basePricePerNight,
        }));
      const totalStayPrice = money(
        nightlyPrices.reduce((sum, night) => sum + night.price, 0),
      );
      result.push({
        ...room,
        minimumAvailableUnits,
        nights: dates.length,
        totalStayPrice,
        averagePricePerNight: money(totalStayPrice / dates.length),
        nightlyPrices,
      });
    }
    return result;
  }

  async getAvailableRooms(hotelId: string, query: StayQueryDto) {
    const hotel = await this.access.hotel(hotelId, true);
    const dates = dateRange(query.checkInDate, query.checkOutDate, true);
    const data = await this.availableRooms([hotel._id], dates);
    data.sort(
      (a, b) =>
        a.averagePricePerNight - b.averagePricePerNight ||
        a._id.toString().localeCompare(b._id.toString()),
    );
    const { page, limit, skip } = pagination(query.page, query.limit);
    // Return every free room, including smaller rooms that can be selected together.
    return {
      hotelId,
      checkInDate: query.checkInDate,
      checkOutDate: query.checkOutDate,
      nights: dates.length,
      guestCount: query.guestCount ?? 1,
      currency: hotel.baseCurrency,
      ...paged(data.slice(skip, skip + limit), data.length, page, limit),
    };
  }
}
