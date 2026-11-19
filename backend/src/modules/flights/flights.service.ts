import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types, isObjectIdOrHexString } from 'mongoose';
import { Role } from '../../common/enums';
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
import { BaggagePolicy } from './airline-baggage-policy.dto';

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

  private async currency(value: string) {
    const currencyCode = value.toUpperCase();
    if (!(await this.reference.countryModel.exists({ currencyCode }))) {
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
}
