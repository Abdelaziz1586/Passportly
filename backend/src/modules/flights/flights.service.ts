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
import { FlightStatus, Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
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
import { CabinCreate } from './add-flight-cabin.dto';

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

  private cabinValues(flight: FlightDocument, input: CabinCreate) {
    return {
      ...input,
      flight: flight._id,
      availableSeats: input.totalSeats,
      heldSeats: 0,
      currency: flight.baseCurrency,
    };
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
}
