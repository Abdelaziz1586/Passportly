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
import { FlightCancel } from './cancel-flight.dto';
import { FlightEventsService } from './flight-events.service';

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
    @InjectConnection() private readonly connection: Connection,
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
}
