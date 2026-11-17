import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
}
