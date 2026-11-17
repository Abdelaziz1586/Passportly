import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { Activity, ActivitySchema } from './schemas/activity.schema';
import { BudgetEntry, BudgetEntrySchema } from './schemas/budget-entry.schema';
import {
  ExchangeRate,
  ExchangeRateSchema,
} from './schemas/exchange-rate.schema';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';
import {
  TransportCost,
  TransportCostSchema,
} from './schemas/transport-cost.schema';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
      { name: Activity.name, schema: ActivitySchema },
      { name: BudgetEntry.name, schema: BudgetEntrySchema },
      { name: TransportCost.name, schema: TransportCostSchema },
      { name: ExchangeRate.name, schema: ExchangeRateSchema },
    ]),
  ],
  controllers: [ItinerariesController],
  providers: [ItinerariesService],
  exports: [ItinerariesService, MongooseModule],
})
export class ItinerariesModule {}
