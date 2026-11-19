import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { Refund, RefundSchema } from '../payments/schemas/refund.schema';
import { PaymentsModule } from '../payments/payments.module';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelBookingViewService } from './hotel-booking-view.service';
import { HotelCancellationService } from './hotel-cancellation.service';
import { HotelBookingsService } from './hotel-bookings.service';
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
    PaymentsModule,
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomAvailability.name, schema: RoomAvailabilitySchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: Review.name, schema: ReviewSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
    ]),
  ],
  controllers: [HotelsController, HotelBookingsController],
  providers: [
    HotelsService,
    HotelBookingsService,
    HotelBookingViewService,
    HotelCancellationService,
  ],
  exports: [HotelsService, HotelBookingsService, MongooseModule],
})
export class HotelsModule {}
