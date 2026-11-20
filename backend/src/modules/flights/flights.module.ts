import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { FlightEventsService } from './flight-events.service';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { AirlinesController } from './airlines.controller';
import { FlightBookingsController } from './flight-bookings.controller';
import { FlightBookingsService } from './flight-bookings.service';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import {
  Airport,
  AirportSchema,
} from '../reference-data/schemas/airport.schema';
import { FlightCancellationService } from './flight-cancellation.service';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { Refund, RefundSchema } from '../payments/schemas/refund.schema';
import { FlightBookingViewService } from './flight-booking-view.service';
import { FlightETicketService } from './flight-e-ticket.service';
import { FlightChangesController } from './flight-changes.controller';
import { FlightChangeService } from './flight-change.service';
import { FlightSeatsController } from './flight-seats.controller';
import { FlightSeatsService } from './flight-seats.service';
import {
  FlightChange,
  FlightChangeSchema,
} from './schemas/flight-change.schema';
import {
  FlightSeatClaim,
  FlightSeatClaimSchema,
} from './schemas/flight-seat-claim.schema';
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
    ReferenceDataModule,
    PaymentsModule,
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: CabinInventory.name, schema: CabinInventorySchema },
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: Airport.name, schema: AirportSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: FlightSeatClaim.name, schema: FlightSeatClaimSchema },
      { name: FlightChange.name, schema: FlightChangeSchema },
    ]),
  ],
  controllers: [
    AirlinesController,
    FlightsController,
    FlightBookingsController,
    FlightSeatsController,
    FlightChangesController,
  ],
  providers: [
    FlightsService,
    FlightEventsService,
    FlightBookingsService,
    FlightETicketService,
    FlightBookingViewService,
    FlightCancellationService,
    FlightSeatsService,
    FlightChangeService,
  ],
  exports: [FlightsService, FlightBookingsService, MongooseModule],
})
export class FlightsModule {}
