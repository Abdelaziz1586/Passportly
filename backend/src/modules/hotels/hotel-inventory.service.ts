import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { UploadsService } from '../uploads/uploads.service';
import { HotelAccessService } from './hotel-access.service';
import { money } from './hotel-utils';
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
}
