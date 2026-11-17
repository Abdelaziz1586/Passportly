import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Activity, ActivityDocument } from './schemas/activity.schema';
import {
  BudgetEntry,
  BudgetEntryDocument,
} from './schemas/budget-entry.schema';
import {
  ExchangeRate,
  ExchangeRateDocument,
} from './schemas/exchange-rate.schema';
import { Itinerary, ItineraryDocument } from './schemas/itinerary.schema';
import {
  TransportCost,
  TransportCostDocument,
} from './schemas/transport-cost.schema';

@Injectable()
export class ItinerariesService {
  constructor(
    @InjectModel(Itinerary.name)
    readonly itineraryModel: Model<ItineraryDocument>,
    @InjectModel(Activity.name)
    readonly activityModel: Model<ActivityDocument>,
    @InjectModel(BudgetEntry.name)
    readonly budgetEntryModel: Model<BudgetEntryDocument>,
    @InjectModel(TransportCost.name)
    readonly transportCostModel: Model<TransportCostDocument>,
    @InjectModel(ExchangeRate.name)
    readonly exchangeRateModel: Model<ExchangeRateDocument>,
    readonly httpService: HttpService,
    readonly configService: ConfigService,
  ) {}
}
