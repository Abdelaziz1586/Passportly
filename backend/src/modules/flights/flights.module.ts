import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesController } from './airlines.controller';
import { FlightBookingsController } from './flight-bookings.controller';
import { FlightBookingsService } from './flight-bookings.service';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import {
  Airport,
  AirportSchema,
} from '../reference-data/schemas/airport.schema';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { Refund, RefundSchema } from '../payments/schemas/refund.schema';
import { FlightBookingViewService } from './flight-booking-view.service';
import { FlightETicketService } from './flight-e-ticket.service';
import { Airline, AirlineSchema } from './schemas/airline.schema';
import {
  CabinInventory,
  CabinInventorySchema,
} from './schemas/cabin-inventory.schema';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';
import { Flight, FlightSchema } from './schemas/flight.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: CabinInventory.name, schema: CabinInventorySchema },
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: Airport.name, schema: AirportSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
    ]),
  ],
  controllers: [
    AirlinesController,
    FlightsController,
    FlightBookingsController,
  ],
  providers: [
    FlightsService,
    FlightBookingsService,
    FlightETicketService,
    FlightBookingViewService,
  ],
  exports: [FlightsService, FlightBookingsService, MongooseModule],
})
export class FlightsModule {}
