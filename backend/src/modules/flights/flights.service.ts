import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
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
} from './schemas/flight-booking.schema';
import { Flight, FlightDocument } from './schemas/flight.schema';
import { FlightUpdate } from './update-flight.dto';
import { airportLocalTime, flightInstant } from './flight-time';
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
}
