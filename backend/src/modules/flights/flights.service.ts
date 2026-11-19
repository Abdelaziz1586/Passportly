import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types, isObjectIdOrHexString } from 'mongoose';
import { BookingStatus, Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
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
import { BookingsQuery } from './flight-bookings-list.dto';

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
}
