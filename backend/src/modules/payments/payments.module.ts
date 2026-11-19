import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CabinInventory,
  CabinInventorySchema,
} from '../flights/schemas/cabin-inventory.schema';
import {
  FlightBooking,
  FlightBookingSchema,
} from '../flights/schemas/flight-booking.schema';
import {
  HotelBooking,
  HotelBookingSchema,
} from '../hotels/schemas/hotel-booking.schema';
import {
  RoomAvailability,
  RoomAvailabilitySchema,
} from '../hotels/schemas/room-availability.schema';
import { BookingPoliciesService } from './booking-policies.service';
import { PaymentWebhookService } from './payment-webhook.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { Refund, RefundSchema } from './schemas/refund.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: CabinInventory.name, schema: CabinInventorySchema },
      { name: RoomAvailability.name, schema: RoomAvailabilitySchema },
    ]),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentWebhookService, BookingPoliciesService],
  exports: [PaymentsService, BookingPoliciesService, MongooseModule],
})
export class PaymentsModule {}
