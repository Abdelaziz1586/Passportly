import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { BookingStatus } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { UploadsService } from '../uploads/uploads.service';
import { CreateRoomDto, StayQueryDto, UpdateRoomDto } from './dto/hotel.dto';
import { HotelAccessService } from './hotel-access.service';
import {
  dateRange,
  isDuplicateKey,
  money,
  objectId,
  paged,
  pagination,
  todayUtc,
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

  /** Booking rows are checked in addition to counters, protecting imported reservations. */
  private async assertNoReservations(
    roomId: string,
    start: Date,
    end: Date | undefined,
    session: ClientSession,
  ): Promise<void> {
    const reservation = await this.bookings
      .exists({
        'rooms.room': objectId(roomId),
        checkOutDate: { $gt: start },
        ...(end ? { checkInDate: { $lt: end } } : {}),
        $or: [
          { status: BookingStatus.CONFIRMED },
          {
            status: {
              $in: [BookingStatus.HELD, BookingStatus.PENDING_PAYMENT],
            },
            $or: [
              { holdExpiresAt: { $gt: new Date() } },
              { holdExpiresAt: null },
            ],
          },
        ],
      })
      .session(session);
    if (reservation)
      throw new ConflictException(
        'Room has overlapping confirmed reservations or active payment holds',
      );
    const allocated = await this.availability
      .exists({
        room: objectId(roomId),
        date: { $gte: start, ...(end ? { $lt: end } : {}) },
        $or: [{ bookedUnits: { $gt: 0 } }, { heldUnits: { $gt: 0 } }],
      })
      .session(session);
    if (allocated)
      throw new ConflictException('Room inventory is already booked or held');
  }

  async updateRoom(
    hotelId: string,
    roomId: string,
    dto: UpdateRoomDto,
    user: AuthenticatedUser,
  ) {
    if (!Object.values(dto).some((value) => value !== undefined))
      throw new BadRequestException('Provide at least one room field');
    await this.access.managedHotel(hotelId, user);
    objectId(roomId, 'roomId');
    const images = dto.images
      ? await this.uploads.storedImages(dto.images)
      : undefined;
    try {
      return await this.connection.transaction(async (session) => {
        const hotel = await this.access.managedHotel(hotelId, user, session);
        const room = await this.access.room(hotelId, roomId, session);
        this.validateRoomCapacity({
          ...room,
          ...Object.fromEntries(
            Object.entries(dto).filter(([, value]) => value !== undefined),
          ),
        });
        if (dto.currency && dto.currency !== hotel.baseCurrency)
          throw new BadRequestException(
            'Room currency must match the hotel currency',
          );
        if (dto.isActive === false) {
          await this.assertNoReservations(
            roomId,
            todayUtc(),
            undefined,
            session,
          );
          // Writing the same night documents as a booking forces conflicting transactions to retry.
          await this.availability.updateMany(
            { room: room._id, date: { $gte: todayUtc() } },
            { $set: { isBlocked: true, blockReason: 'Room deactivated' } },
            { session },
          );
        }
        if (dto.totalUnits !== undefined && dto.totalUnits < room.totalUnits) {
          const overCapacity = await this.availability
            .exists({
              room: room._id,
              date: { $gte: todayUtc() },
              $expr: {
                $gt: [{ $add: ['$bookedUnits', '$heldUnits'] }, dto.totalUnits],
              },
            })
            .session(session);
          if (overCapacity)
            throw new ConflictException(
              'Unit count cannot be reduced below booked plus held units',
            );
          await this.availability.updateMany(
            {
              room: room._id,
              date: { $gte: todayUtc() },
              totalUnits: { $gt: dto.totalUnits },
            },
            { $set: { totalUnits: dto.totalUnits } },
            { session },
          );
        }
        return this.rooms
          .findOneAndUpdate(
            { _id: room._id, hotel: hotel._id },
            { $set: { ...dto, ...(images ? { images } : {}) } },
            { session, returnDocument: 'after', runValidators: true },
          )
          .lean();
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
