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
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { UploadsModule } from '../uploads/uploads.module';
import { HotelAccessService } from './hotel-access.service';
import { HotelInventoryService } from './hotel-inventory.service';
import { HotelReviewsService } from './hotel-reviews.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [
    ReferenceDataModule,
    UploadsModule,
    AuditLogsModule,
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomAvailability.name, schema: RoomAvailabilitySchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: Review.name, schema: ReviewSchema },
    ]),
  ],
  controllers: [HotelsController, HotelBookingsController],
  providers: [
    HotelsService,
    HotelAccessService,
    HotelInventoryService,
    HotelReviewsService,
  ],
  exports: [
    HotelsService,
    HotelInventoryService,
    HotelReviewsService,
    MongooseModule,
  ],
})
export class HotelsModule {}
