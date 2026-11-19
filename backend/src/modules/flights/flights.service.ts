import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FlightStatus } from '../../common/enums';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { Airline, AirlineDocument } from './schemas/airline.schema';
import {
  CabinInventory,
  CabinInventoryDocument,
} from './schemas/cabin-inventory.schema';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';
import { Flight, FlightDocument } from './schemas/flight.schema';

@Injectable()
export class FlightsService {
  constructor(
    @InjectModel(Airline.name) readonly airlineModel: Model<AirlineDocument>,
    @InjectModel(Flight.name) readonly flightModel: Model<FlightDocument>,
    @InjectModel(CabinInventory.name)
    readonly cabinInventoryModel: Model<CabinInventoryDocument>,
    @InjectModel(FlightBooking.name)
    readonly flightBookingModel: Model<FlightBookingDocument>,
    readonly referenceDataService: ReferenceDataService,
  ) {}

  async searchForCityRoutes(
    routes: Array<{
      departureCityId: string;
      arrivalCityId: string;
      departureDate: Date;
    }>,
  ): Promise<FlightDocument[]> {
    if (routes.length === 0) return [];

    const cityIds = Array.from(
      new Set(
        routes.flatMap((route) => [route.departureCityId, route.arrivalCityId]),
      ),
    ).map((id) => new Types.ObjectId(id));
    const airports = await this.referenceDataService.airportModel
      .find({ city: { $in: cityIds } })
      .select('_id city timezone')
      .lean()
      .exec();
    const airportsByCity = new Map<
      string,
      Array<{ id: Types.ObjectId; timezone: string }>
    >();
    for (const airport of airports) {
      if (!airport.city) continue;
      const cityId = String(airport.city);
      const cityAirports = airportsByCity.get(cityId) ?? [];
      cityAirports.push({ id: airport._id, timezone: airport.timezone });
      airportsByCity.set(cityId, cityAirports);
    }

    const routeFilters = routes.flatMap((route) => {
      const departures = airportsByCity.get(route.departureCityId) ?? [];
      const arrivals = airportsByCity.get(route.arrivalCityId) ?? [];
      if (departures.length === 0 || arrivals.length === 0) return [];
      return departures.map((departure) => {
        const { start, end } = this.localDateWindow(
          route.departureDate,
          departure.timezone,
        );
        return {
          departureAirport: departure.id,
          arrivalAirport: { $in: arrivals.map((airport) => airport.id) },
          departureTime: { $gte: start, $lt: end },
        };
      });
    });
    if (routeFilters.length === 0) return [];

    const activeAirlines = await this.airlineModel
      .find({ isActive: true })
      .distinct('_id')
      .exec();

    return this.flightModel
      .find({
        $or: routeFilters,
        airline: { $in: activeAirlines },
        status: { $ne: FlightStatus.CANCELLED },
      })
      .sort({ departureTime: 1 })
      .populate('airline', 'name iataCode logoUrl')
      .populate('departureAirport', 'name iataCode cityName timezone')
      .populate('arrivalAirport', 'name iataCode cityName timezone')
      .exec();
  }

  private localDateWindow(
    date: Date,
    timeZone: string,
  ): { start: Date; end: Date } {
    const start = this.localMidnightUtc(date, timeZone);
    const nextDate = new Date(date);
    nextDate.setUTCHours(0, 0, 0, 0);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    return { start, end: this.localMidnightUtc(nextDate, timeZone) };
  }

  private localMidnightUtc(date: Date, timeZone: string): Date {
    const target = new Date(date);
    target.setUTCHours(0, 0, 0, 0);
    let candidate = new Date(target);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = formatter.formatToParts(candidate);
      const part = (type: Intl.DateTimeFormatPartTypes): number => {
        const value = parts.find((entry) => entry.type === type)?.value;
        return value ? Number(value) : 0;
      };
      const displayedAsUtc = new Date(0);
      displayedAsUtc.setUTCFullYear(
        part('year'),
        part('month') - 1,
        part('day'),
      );
      displayedAsUtc.setUTCHours(
        part('hour'),
        part('minute'),
        part('second'),
        0,
      );
      const adjustment = target.getTime() - displayedAsUtc.getTime();
      if (adjustment === 0) return candidate;
      candidate = new Date(candidate.getTime() + adjustment);
    }
    return candidate;
  }
}
