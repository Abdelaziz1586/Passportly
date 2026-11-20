import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ClientSession,
  Connection,
  Model,
  Types,
  isObjectIdOrHexString,
} from 'mongoose';
import { FlightStatus, Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
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
import { AirlineCreate } from './create-airline.dto';
import { BaggagePolicy } from './airline-baggage-policy.dto';
import { CancellationPolicy } from './airline-cancellation-policy.dto';
import { AirlineUpdate } from './update-airline.dto';
import { CabinCreate, FlightCreate, FlightUpdate } from './create-flight.dto';
import { FlightSearch } from './flight-search.dto';
import {
  airportLocalTime,
  assertLocalDate,
  flightInstant,
} from './flight-time';

function checkId(id: string) {
  if (!isObjectIdOrHexString(id)) throw new BadRequestException('Invalid ID');
}

async function unique<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      error.code === 11000
    ) {
      throw new ConflictException(
        'A record with this code, flight date or cabin already exists',
      );
    }
    throw error;
  }
}

@Injectable()
export class FlightsService {
  constructor(
    @InjectModel(Airline.name) readonly airlineModel: Model<AirlineDocument>,
    @InjectModel(Flight.name) readonly flightModel: Model<FlightDocument>,
    @InjectModel(CabinInventory.name)
    readonly cabinInventoryModel: Model<CabinInventoryDocument>,
    @InjectModel(FlightBooking.name)
    readonly flightBookingModel: Model<FlightBookingDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly reference: ReferenceDataService,
  ) {}

  private authorize(user: AuthenticatedUser, airline: Types.ObjectId) {
    if (user.role === Role.ADMIN) return;
    if (
      user.role !== Role.AIRLINE_MODERATOR ||
      user.assignedProviderType !== 'airline' ||
      user.assignedProviderId !== airline.toString()
    ) {
      throw new ForbiddenException(
        'Flight or profile belongs to another airline',
      );
    }
  }

  private async airline(
    id: string,
    user?: AuthenticatedUser,
    session?: ClientSession,
  ) {
    checkId(id);
    const airline = await this.airlineModel
      .findById(id)
      .session(session ?? null);
    if (!airline) throw new NotFoundException('Airline not found');
    if (user) this.authorize(user, airline._id);
    return airline;
  }

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

  async createAirline(
    user: AuthenticatedUser,
    input: AirlineCreate,
    logoUrl?: string,
  ) {
    if (user.role !== Role.ADMIN) throw new ForbiddenException();
    return this.airlineView(
      await unique(() =>
        this.airlineModel.create({
          ...input,
          logoUrl,
          cancellationPolicy: { tiers: [] },
        }),
      ),
    );
  }

  async getAirline(id: string) {
    return this.airlineView(await this.airline(id));
  }

  async updateAirline(
    id: string,
    user: AuthenticatedUser,
    input: AirlineUpdate,
    logoUrl?: string,
  ) {
    const airline = await this.airline(id, user);
    airline.set(input);
    if (logoUrl !== undefined) airline.logoUrl = logoUrl;
    return this.airlineView(await unique(() => airline.save()));
  }

  private async currency(value: string) {
    const currencyCode = value.toUpperCase();
    if (!(await this.reference.isCurrencySupported(currencyCode))) {
      throw new BadRequestException('Unsupported currency');
    }
    return currencyCode;
  }

  async updateBaggage(
    id: string,
    user: AuthenticatedUser,
    input: BaggagePolicy,
  ) {
    const airline = await this.airline(id, user);
    airline.set('baggagePolicy', {
      ...input,
      currency: await this.currency(input.currency),
    });
    return this.airlineView(await airline.save());
  }
  async updateCancellation(
    id: string,
    user: AuthenticatedUser,
    input: CancellationPolicy,
  ) {
    const airline = await this.airline(id, user);
    airline.set('cancellationPolicy', {
      tiers: [...input.tiers].sort(
        (a, b) => a.daysBeforeDeparture - b.daysBeforeDeparture,
      ),
    });
    return this.airlineView(await airline.save());
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

  private async flight(
    id: string,
    user?: AuthenticatedUser,
    session?: ClientSession,
  ) {
    checkId(id);
    const flight = await this.flightModel.findById(id).session(session ?? null);
    if (!flight) throw new NotFoundException('Flight not found');
    if (user) this.authorize(user, flight.airline);
    return flight;
  }

  private async schedule(input: FlightUpdate, flight?: Flight) {
    const [origin, destination] = await Promise.all([
      this.airport(
        input.departureAirport ?? flight!.departureAirport.toString(),
      ),
      this.airport(input.arrivalAirport ?? flight!.arrivalAirport.toString()),
    ]);
    if (origin._id.equals(destination._id))
      throw new BadRequestException('Airports must differ');
    const departureTime =
      input.departureTime === undefined
        ? flight!.departureTime
        : flightInstant(input.departureTime, origin.timezone);
    const arrivalTime =
      input.arrivalTime === undefined
        ? flight!.arrivalTime
        : flightInstant(input.arrivalTime, destination.timezone);
    if (departureTime.getTime() <= Date.now() || arrivalTime <= departureTime) {
      throw new BadRequestException(
        'Departure must be in the future and before arrival',
      );
    }
    return {
      departureAirport: origin._id,
      arrivalAirport: destination._id,
      departureTime,
      arrivalTime,
      durationMinutes: Math.ceil((+arrivalTime - +departureTime) / 60000),
      localDepartureDate: airportLocalTime(
        departureTime,
        origin.timezone,
      ).slice(0, 10),
    };
  }

  private async checkLegacyFlightDate(
    airline: Types.ObjectId,
    flightNumber: string,
    localDepartureDate: string,
    session: ClientSession,
    currentId?: Types.ObjectId,
  ) {
    const candidates = await this.flightModel
      .find({
        airline,
        flightNumber: flightNumber.trim().toUpperCase(),
        localDepartureDate: { $exists: false },
        departureTime: {
          $gte: new Date(Date.parse(localDepartureDate) - 86400000),
          $lt: new Date(Date.parse(localDepartureDate) + 172800000),
        },
        ...(currentId && { _id: { $ne: currentId } }),
      })
      .session(session)
      .lean();

    for (const candidate of candidates) {
      const airport = await this.airport(candidate.departureAirport.toString());
      if (
        airportLocalTime(candidate.departureTime, airport.timezone).slice(
          0,
          10,
        ) === localDepartureDate
      ) {
        throw new ConflictException(
          'This airline already uses that flight number on the local departure date',
        );
      }
    }
  }

  private cabinValues(flight: FlightDocument, input: CabinCreate) {
    return {
      ...input,
      flight: flight._id,
      availableSeats: input.totalSeats,
      heldSeats: 0,
      currency: flight.baseCurrency,
    };
  }

  async createFlight(user: AuthenticatedUser, input: FlightCreate) {
    const { airlineId, cabins, baseCurrency, ...fields } = input;
    const airline = await this.airline(airlineId, user);
    const schedule = await this.schedule(input);
    const currency = await this.currency(baseCurrency ?? 'USD');
    const id = await unique(() =>
      this.connection.transaction(async (session) => {
        await this.checkLegacyFlightDate(
          airline._id,
          input.flightNumber,
          schedule.localDepartureDate,
          session,
        );
        const [flight] = await this.flightModel.create(
          [
            {
              ...fields,
              ...schedule,
              airline: airline._id,
              baseCurrency: currency,
            },
          ],
          { session },
        );
        if (cabins?.length) {
          await this.cabinInventoryModel.insertMany(
            cabins.map((cabin) => this.cabinValues(flight, cabin)),
            { session },
          );
        }
        return flight._id.toString();
      }),
    );
    return this.flightDetails(id);
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

  private async flightDetails(id: string) {
    const flight = await this.flight(id);
    const [airline, origin, destination, cabins] = await Promise.all([
      this.airline(flight.airline.toString()),
      this.airport(flight.departureAirport.toString()),
      this.airport(flight.arrivalAirport.toString()),
      this.cabinInventoryModel
        .find({ flight: flight._id, isActive: true })
        .lean(),
    ]);
    return {
      id,
      flightNumber: flight.flightNumber,
      airline: this.airlineView(airline),
      departureAirport: origin,
      arrivalAirport: destination,
      departureTime: airportLocalTime(flight.departureTime, origin.timezone),
      arrivalTime: airportLocalTime(flight.arrivalTime, destination.timezone),
      durationMinutes: flight.durationMinutes,
      stopsCount: flight.stopsCount,
      aircraftType: flight.aircraftType,
      status:
        flight.status === FlightStatus.SCHEDULED &&
        +flight.departureTime <= Date.now()
          ? FlightStatus.DEPARTED
          : flight.status,
      cabins: cabins.map((cabin) => this.cabinView(cabin, airline)),
    };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async markDeparted() {
    await this.flightModel.updateMany(
      { status: FlightStatus.SCHEDULED, departureTime: { $lte: new Date() } },
      { $set: { status: FlightStatus.DEPARTED } },
    );
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

  async getFlight(id: string) {
    return this.flightDetails(id);
  }
}
