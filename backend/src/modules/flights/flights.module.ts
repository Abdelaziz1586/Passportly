import { Module } from '@nestjs/common';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { FlightEventsService } from './flight-events.service';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesController } from './airlines.controller';
import { FlightBookingsController } from './flight-bookings.controller';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
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
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: CabinInventory.name, schema: CabinInventorySchema },
      { name: FlightBooking.name, schema: FlightBookingSchema },
    ]),
  ],
  controllers: [
    AirlinesController,
    FlightsController,
    FlightBookingsController,
  ],
  providers: [FlightsService, FlightEventsService],
  exports: [FlightsService, MongooseModule],
})
export class FlightsModule {}
