import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BookingStatus } from '../../common/enums';
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

  async findConfirmedBookingForUser(
    bookingId: string,
    userId: string,
  ): Promise<HotelBookingDocument | null> {
    return this.hotelBookingModel
      .findOne({
        _id: new Types.ObjectId(bookingId),
        user: new Types.ObjectId(userId),
        status: BookingStatus.CONFIRMED,
      })
      .exec();
  }

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
}
