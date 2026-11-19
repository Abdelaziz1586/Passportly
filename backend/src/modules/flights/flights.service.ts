import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types, isObjectIdOrHexString } from 'mongoose';
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
import { airportLocalTime } from './flight-time';

function checkId(id: string) {
  if (!isObjectIdOrHexString(id)) throw new BadRequestException('Invalid ID');
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

  async getFlight(id: string) {
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
}
