import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import {
  HotelBooking,
  HotelBookingSchema,
} from './schemas/hotel-booking.schema';
import { Hotel, HotelSchema } from './schemas/hotel.schema';
import { Review, ReviewSchema } from './schemas/review.schema';
import {
  RoomAvailability,
  RoomAvailabilitySchema,
} from './schemas/room-availability.schema';
import { Room, RoomSchema } from './schemas/room.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomAvailability.name, schema: RoomAvailabilitySchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: Review.name, schema: ReviewSchema },
    ]),
  ],
  controllers: [HotelsController, HotelBookingsController],
  providers: [HotelsService],
  exports: [HotelsService, MongooseModule],
})
export class HotelsModule {}
