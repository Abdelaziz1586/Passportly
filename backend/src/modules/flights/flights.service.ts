import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isObjectIdOrHexString } from 'mongoose';
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
import { FlightSearch } from './flight-search.dto';
import { airportLocalTime, assertLocalDate } from './flight-time';

@Injectable()
export class FlightsService {
  constructor(
    @InjectModel(Airline.name) readonly airlineModel: Model<AirlineDocument>,
    @InjectModel(Flight.name) readonly flightModel: Model<FlightDocument>,
    @InjectModel(CabinInventory.name)
    readonly cabinInventoryModel: Model<CabinInventoryDocument>,
    @InjectModel(FlightBooking.name)
    readonly flightBookingModel: Model<FlightBookingDocument>,
    private readonly reference: ReferenceDataService,
  ) {}

  private airlineView(airline: AirlineDocument) {
    return {
      id: airline._id.toString(),
      name: airline.name,
      iataCode: airline.iataCode,
      icaoCode: airline.icaoCode,
      logoUrl: airline.logoUrl,
      description: airline.description,
      isActive: airline.isActive,
      baggagePolicy: airline.baggagePolicy,
      cancellationPolicy: { tiers: airline.cancellationPolicy?.tiers ?? null },
    };
  }

  private async currency(value: string) {
    const currencyCode = value.toUpperCase();
    if (!(await this.reference.countryModel.exists({ currencyCode }))) {
      throw new BadRequestException('Unsupported currency');
    }
    return currencyCode;
  }

  private async airport(value: string) {
    const airport = await this.reference.airportModel
      .findOne(
        isObjectIdOrHexString(value)
          ? { _id: value }
          : { iataCode: value.trim().toUpperCase() },
      )
      .lean();
    if (!airport) throw new BadRequestException('Unknown airport');
    return airport;
  }

  private cabinView(
    cabin: CabinInventory & { _id: Types.ObjectId },
    airline: AirlineDocument,
  ) {
    return {
      id: cabin._id.toString(),
      cabinClass: cabin.cabinClass,
      basePrice: cabin.basePrice,
      currency: cabin.currency,
      availableSeats: cabin.availableSeats,
      checkedBagsIncluded:
        cabin.checkedBagsIncludedOverride ??
        airline.baggagePolicy.checkedBagsIncluded,
      checkedBagMaxWeightKg:
        cabin.checkedBagMaxWeightKgOverride ??
        airline.baggagePolicy.checkedBagMaxWeightKg,
    };
  }

  async searchFlights(input: FlightSearch) {
    const {
      adults = 1,
      children = 0,
      infants = 0,
      page = 1,
      limit = 20,
      sort = 'departure',
    } = input;
    if (infants > adults)
      throw new BadRequestException('Infants cannot outnumber adults');
    if (
      input.minPrice !== undefined &&
      input.maxPrice !== undefined &&
      input.minPrice > input.maxPrice
    ) {
      throw new BadRequestException('minPrice cannot exceed maxPrice');
    }
    const comparesPrice =
      sort === 'price' ||
      input.minPrice !== undefined ||
      input.maxPrice !== undefined;
    if (comparesPrice && !input.currency)
      throw new BadRequestException('Specify a currency to compare prices');
    const currency = input.currency && (await this.currency(input.currency));
    const minorUnit = currency
      ? 10 **
        (new Intl.NumberFormat('en', {
          style: 'currency',
          currency,
        }).resolvedOptions().maximumFractionDigits ?? 2)
      : 100;
    assertLocalDate(input.departureDate);
    if (input.returnDate) {
      assertLocalDate(input.returnDate);
      if (input.returnDate < input.departureDate)
        throw new BadRequestException('Return date precedes departure');
    }
    const [origin, destination, airlines] = await Promise.all([
      this.airport(input.origin),
      this.airport(input.destination),
      this.airlineModel.find({ isActive: true }),
    ]);
    if (origin._id.equals(destination._id))
      throw new BadRequestException('Airports must differ');
    const active = new Map(
      airlines.map((airline) => [airline._id.toString(), airline]),
    );
    const leg = async (
      from: typeof origin,
      to: typeof destination,
      date: string,
    ) => {
      const flights = await this.flightModel
        .find({
          airline: { $in: airlines.map((airline) => airline._id) },
          departureAirport: from._id,
          arrivalAirport: to._id,
          departureTime: { $gt: new Date() },
          status: FlightStatus.SCHEDULED,
          $or: [
            { localDepartureDate: date },
            {
              localDepartureDate: { $exists: false },
              departureTime: {
                $gt: new Date(
                  Math.max(Date.now(), Date.parse(date) - 86400000),
                ),
                $lt: new Date(Date.parse(date) + 172800000),
              },
            },
          ],
          ...(input.maxStops === undefined
            ? {}
            : { stopsCount: { $lte: input.maxStops } }),
        })
        .lean();
      const cabins = await this.cabinInventoryModel
        .find({
          flight: { $in: flights.map((flight) => flight._id) },
          isActive: true,
          availableSeats: { $gte: adults + children },
          ...(currency ? { currency } : {}),
          ...(input.cabinClass ? { cabinClass: input.cabinClass } : {}),
        })
        .lean();
      const byFlight = new Map(
        flights.map((flight) => [flight._id.toString(), flight]),
      );
      const results = cabins.flatMap((cabin) => {
        const flight = byFlight.get(cabin.flight.toString())!;
        const departureTime = airportLocalTime(
          flight.departureTime,
          from.timezone,
        );
        if (departureTime.slice(0, 10) !== date) return [];
        const units = currency
          ? minorUnit
          : 10 **
            (new Intl.NumberFormat('en', {
              style: 'currency',
              currency: cabin.currency,
            }).resolvedOptions().maximumFractionDigits ?? 2);
        const fare = Math.round(cabin.basePrice * units);
        const total =
          fare * (adults + children) + Math.round(fare * 0.1) * infants;
        if (
          input.minPrice !== undefined &&
          total < Math.round(input.minPrice * units)
        )
          return [];
        if (
          input.maxPrice !== undefined &&
          total > Math.round(input.maxPrice * units)
        )
          return [];
        return [
          {
            id: flight._id.toString(),
            flightNumber: flight.flightNumber,
            departureTime,
            departureUtc: flight.departureTime,
            arrivalTime: airportLocalTime(flight.arrivalTime, to.timezone),
            durationMinutes: flight.durationMinutes,
            stopsCount: flight.stopsCount,
            partyFare: total / units,
            cabin: this.cabinView(
              cabin,
              active.get(flight.airline.toString())!,
            ),
            airline: this.airlineView(active.get(flight.airline.toString())!),
          },
        ];
      });
      results.sort(
        (a, b) =>
          (sort === 'price'
            ? a.partyFare - b.partyFare
            : sort === 'duration'
              ? a.durationMinutes - b.durationMinutes
              : 0) ||
          +a.departureUtc - +b.departureUtc ||
          a.id.localeCompare(b.id) ||
          a.cabin.id.localeCompare(b.cabin.id),
      );
      return {
        data: results.slice((page - 1) * limit, page * limit),
        total: results.length,
        page,
        limit,
      };
    };
    const [outbound, inbound] = await Promise.all([
      leg(origin, destination, input.departureDate),
      input.returnDate ? leg(destination, origin, input.returnDate) : undefined,
    ]);
    return { outbound, ...(inbound && { return: inbound }) };
  }
}
