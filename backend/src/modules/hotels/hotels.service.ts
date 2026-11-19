import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
}
