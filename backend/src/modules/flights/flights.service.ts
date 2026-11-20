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
import {
  BookingStatus,
  FlightStatus,
  NotificationType,
  Role,
} from '../../common/enums';
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
  FlightBookingLeg,
} from './schemas/flight-booking.schema';
import { Flight, FlightDocument } from './schemas/flight.schema';
import { AirlineCreate } from './create-airline.dto';
import { BaggagePolicy } from './airline-baggage-policy.dto';
import { CancellationPolicy } from './airline-cancellation-policy.dto';
import { AirlineUpdate } from './update-airline.dto';
import {
  CabinCreate,
  CabinUpdate,
  FlightCreate,
  FlightUpdate,
} from './create-flight.dto';
import { FlightSearch } from './flight-search.dto';
import {
  airportLocalTime,
  assertLocalDate,
  flightInstant,
} from './flight-time';
import { FlightCancel } from './cancel-flight.dto';
import { BookingsQuery } from './flight-bookings-list.dto';
import { FlightEventsService } from './flight-events.service';

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
    private readonly events: FlightEventsService,
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
    const airports = await this.reference.airportModel
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

  private assertScheduled(flight: Flight) {
    if (
      flight.status !== FlightStatus.SCHEDULED ||
      flight.departureTime.getTime() <= Date.now()
    ) {
      throw new ConflictException(
        'Only future scheduled flights can be changed',
      );
    }
  }

  /** Booking and payment transactions must acquire this same write before touching inventory. */
  async lockScheduledFlight(id: Types.ObjectId, session: ClientSession) {
    const flight = await this.flightModel.findOneAndUpdate(
      {
        _id: id,
        status: FlightStatus.SCHEDULED,
        departureTime: { $gt: new Date() },
      },
      { $inc: { bookingVersion: 1 } },
      { session, returnDocument: 'after' },
    );
    if (!flight) throw new ConflictException('Flight is no longer scheduled');
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
  async updateFlight(id: string, user: AuthenticatedUser, input: FlightUpdate) {
    await unique(() =>
      this.connection.transaction(async (session) => {
        const current = await this.flight(id, user, session);
        const flight = await this.lockScheduledFlight(current._id, session);
        const schedule = await this.schedule(input, flight);
        if (
          (!flight.departureAirport.equals(schedule.departureAirport) ||
            !flight.arrivalAirport.equals(schedule.arrivalAirport)) &&
          (await this.flightBookingModel
            .exists({ 'legs.flight': flight._id })
            .session(session))
        ) {
          throw new ConflictException('Airports cannot change after booking');
        }
        const changed =
          +flight.departureTime !== +schedule.departureTime ||
          +flight.arrivalTime !== +schedule.arrivalTime;
        await this.checkLegacyFlightDate(
          flight.airline,
          input.flightNumber ?? flight.flightNumber,
          schedule.localDepartureDate,
          session,
          flight._id,
        );
        flight.set({ ...input, ...schedule });
        await flight.save({ session });
        if (changed) {
          const bookings = await this.flightBookingModel
            .find({
              'legs.flight': flight._id,
              status: BookingStatus.CONFIRMED,
            })
            .session(session);
          for (const booking of bookings) {
            await this.events.notify(
              booking,
              flight,
              NotificationType.FLIGHT_SCHEDULE_CHANGED,
              session,
            );
          }
        }
      }),
    );
    return this.flightDetails(id);
  }
  /**
   * Call in the webhook transaction after marking the verified Stripe payment
   * successful. Returns false for bookings outside the cancellation workflow.
   */
  async queuePaymentAfterCancellation(
    bookingId: Types.ObjectId,
    paymentId: Types.ObjectId,
    session: ClientSession,
  ): Promise<boolean> {
    const booking = await this.flightBookingModel
      .findOne({
        _id: bookingId,
        providerCancellationFlight: { $exists: true },
        status: BookingStatus.EXPIRED,
      })
      .session(session);
    if (!booking) return false;
    if (
      booking.payment?.equals(paymentId) &&
      booking.refundAmount !== undefined
    )
      return true;
    if (booking.payment && !booking.payment.equals(paymentId)) {
      throw new ConflictException(
        'A different payment is already attached to the cancelled booking',
      );
    }

    booking.refundAmount = await this.events.queueRefund(
      booking,
      session,
      paymentId,
    );
    booking.payment = paymentId;
    await booking.save({ session });
    return true;
  }

  async cancelFlight(id: string, user: AuthenticatedUser, input: FlightCancel) {
    return this.connection.transaction(async (session) => {
      const flight = await this.flight(id, user, session);
      if (flight.status === FlightStatus.CANCELLED)
        return {
          id,
          status: flight.status,
          cancellationReason: flight.cancellationReason,
        };
      this.assertScheduled(flight);
      flight.status = FlightStatus.CANCELLED;
      flight.cancellationReason = input.reason;
      await flight.save({ session });
      const bookings = await this.flightBookingModel
        .find({
          'legs.flight': flight._id,
          status: {
            $in: [
              BookingStatus.CONFIRMED,
              BookingStatus.PENDING_PAYMENT,
              BookingStatus.HELD,
            ],
          },
        })
        .session(session);
      for (const booking of bookings) {
        const confirmed = booking.status === BookingStatus.CONFIRMED;
        const seats = booking.passengerCounts.totalSeatsRequired;
        for (const leg of booking.legs) {
          const result = await this.cabinInventoryModel.updateOne(
            {
              _id: leg.cabin,
              flight: leg.flight,
              $expr: {
                $lte: [{ $add: ['$availableSeats', seats] }, '$totalSeats'],
              },
              ...(confirmed ? {} : { heldSeats: { $gte: seats } }),
            },
            {
              $inc: {
                availableSeats: seats,
                ...(confirmed ? {} : { heldSeats: -seats }),
              },
            },
            { session },
          );
          if (!result.matchedCount)
            throw new ConflictException('Booking inventory is inconsistent');
        }
        booking.status = confirmed
          ? BookingStatus.CANCELLED
          : BookingStatus.EXPIRED;
        booking.cancelledAt = new Date();
        booking.cancellationReason = input.reason;
        booking.providerCancellationFlight = flight._id;
        if (confirmed) {
          booking.refundAmount = await this.events.queueRefund(
            booking,
            session,
          );
        }
        await booking.save({ session });
        await this.events.notify(
          booking,
          flight,
          NotificationType.FLIGHT_CANCELLED,
          session,
        );
      }
      return {
        id,
        status: flight.status,
        cancellationReason: flight.cancellationReason,
      };
    });
  }
  async addCabin(id: string, user: AuthenticatedUser, input: CabinCreate) {
    return unique(() =>
      this.connection.transaction(async (session) => {
        const current = await this.flight(id, user, session);
        const flight = await this.lockScheduledFlight(current._id, session);
        const [cabin] = await this.cabinInventoryModel.create(
          [this.cabinValues(flight, input)],
          { session },
        );
        return this.cabinView(
          cabin,
          await this.airline(flight.airline.toString(), undefined, session),
        );
      }),
    );
  }
  async updateCabin(
    id: string,
    cabinId: string,
    user: AuthenticatedUser,
    input: CabinUpdate,
  ) {
    checkId(cabinId);
    return this.connection.transaction(async (session) => {
      const current = await this.flight(id, user, session);
      const flight = await this.lockScheduledFlight(current._id, session);
      const cabin = await this.cabinInventoryModel
        .findOne({ _id: cabinId, flight: flight._id })
        .session(session);
      if (!cabin) throw new NotFoundException('Cabin not found');
      const delta = (input.totalSeats ?? cabin.totalSeats) - cabin.totalSeats;
      const updated = await this.cabinInventoryModel.findOneAndUpdate(
        {
          _id: cabin._id,
          availableSeats: { $gte: Math.max(0, -delta) },
        },
        { $set: input, $inc: { availableSeats: delta } },
        { session, returnDocument: 'after' },
      );
      if (!updated)
        throw new ConflictException('Capacity is below booked and held seats');
      return this.cabinView(
        updated,
        await this.airline(flight.airline.toString(), undefined, session),
      );
    });
  }
  private seat(
    booking: FlightBooking,
    leg: FlightBookingLeg,
    passengerIndex: number,
  ) {
    const legIndex = booking.legs.indexOf(leg);
    return (
      booking.passengers[passengerIndex].seatAssignments?.[legIndex] || null
    );
  }

  async getFlightBookings(
    id: string,
    user: AuthenticatedUser,
    query: BookingsQuery,
  ) {
    const flight = await this.flight(id, user);
    const { page = 1, limit = 20, status } = query;
    const filter = {
      'legs.flight': flight._id,
      status: status ?? {
        $in: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
      },
    };
    const [bookings, total, cabins] = await Promise.all([
      this.flightBookingModel
        .find(filter)
        .sort({ _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.flightBookingModel.countDocuments(filter),
      this.cabinInventoryModel
        .find({ flight: flight._id, isActive: true })
        .lean(),
    ]);
    const data = bookings.map((booking) => {
      const leg = booking.legs.find((leg) => leg.flight.equals(flight._id))!;
      return {
        bookingReference: booking.bookingReference,
        status: booking.status,
        cabin: leg.cabinClass,
        passengers: booking.passengers.map((passenger, index) => ({
          name: [passenger.firstName, passenger.lastName].join(' '),
          seat: this.seat(booking, leg, index),
        })),
      };
    });
    return {
      data,
      total,
      page,
      limit,
      cabins: cabins.map((cabin) => ({
        cabinClass: cabin.cabinClass,
        availableSeats: cabin.availableSeats,
      })),
    };
  }
  async manifest(id: string, user: AuthenticatedUser) {
    const flight = await this.flight(id, user);
    const bookings = await this.flightBookingModel
      .find({ 'legs.flight': flight._id, status: BookingStatus.CONFIRMED })
      .sort({ _id: 1 })
      .lean();
    return bookings.flatMap((booking) => {
      const leg = booking.legs.find((leg) => leg.flight.equals(flight._id))!;
      return booking.passengers.map((passenger, index) => ({
        name: [passenger.firstName, passenger.lastName].join(' '),
        type: passenger.type,
        cabin: leg.cabinClass,
        seat: this.seat(booking, leg, index),
        eTicketReference: passenger.eTicketNumber ?? null,
        extraBaggageCount: passenger.extraBaggageCount,
        bookingReference: booking.bookingReference,
      }));
    });
  }
}
