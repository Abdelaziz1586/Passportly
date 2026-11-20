import { HotelAdminAuditInterceptor } from './hotel-admin-audit.interceptor';
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
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { UploadsModule } from '../uploads/uploads.module';
import { HotelAccessService } from './hotel-access.service';
import { HotelInventoryService } from './hotel-inventory.service';
import { HotelReviewsService } from './hotel-reviews.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    PaymentsModule,
    ReferenceDataModule,
    UploadsModule,
    AuditLogsModule,
    NotificationsModule,
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
    HotelAdminAuditInterceptor,
    HotelsService,
    HotelAccessService,
    HotelInventoryService,
    HotelReviewsService,
    HotelBookingsService,
    HotelBookingViewService,
    HotelCancellationService,
  ],
  exports: [
    HotelsService,
    HotelInventoryService,
    HotelReviewsService,
    HotelBookingsService,
    MongooseModule,
  ],
})
export class HotelsModule {}
