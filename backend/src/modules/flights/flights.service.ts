import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types, isObjectIdOrHexString } from 'mongoose';
import { Role } from '../../common/enums';
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
import { AirlineCreate } from './create-airline.dto';
import { AirlineUpdate } from './update-airline.dto';

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
}
