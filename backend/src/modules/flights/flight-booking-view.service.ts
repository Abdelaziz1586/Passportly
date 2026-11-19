import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { Payment } from '../payments/schemas/payment.schema';
import { loadReadableFlightBookingRaw } from './flight-booking-access';
import {
  BookingViewAirport,
  BookingViewLeg,
  BookingViewPayment,
  effectiveStatus,
  FlightBookingDetails,
  toViewPassenger,
} from './flight-booking-view';
import { Airport } from '../reference-data/schemas/airport.schema';
import { Airline } from './schemas/airline.schema';
import { FlightBooking } from './schemas/flight-booking.schema';
import { Flight } from './schemas/flight.schema';

type Lean<T> = T & { _id: Types.ObjectId };

/**
 * FLT-25 (SCRUM-73): the full details of one flight booking: legs, passengers
 * and a payment summary. Who may read it is decided by
 * loadReadableFlightBookingRaw (owner, admin, or the moderator of an airline
 * operating a flight of it); the raw document is always mapped here.
 */
@Injectable()
export class FlightBookingViewService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    @InjectModel(Airport.name) private readonly airportModel: Model<Airport>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
  ) {}

  async getBooking(
    user: AuthenticatedUser,
    id: string,
  ): Promise<FlightBookingDetails> {
    const booking = await loadReadableFlightBookingRaw(
      user,
      id,
      this.bookingModel,
      this.flightModel,
    );
    // An airline moderator sees the manifest of their own legs, not prices, payments or personal details.
    const moderatorAirline =
      user.role === Role.AIRLINE_MODERATOR
        ? user.assignedProviderId
        : undefined;
    const moderatorView = moderatorAirline !== undefined;
    const now = new Date();

    const flights = (await this.flightModel
      .find({ _id: { $in: booking.legs.map((leg) => leg.flight) } })
      .lean()) as unknown as Lean<Flight>[];
    const airlines = (await this.airlineModel
      .find({ _id: { $in: flights.map((flight) => flight.airline) } })
      .lean()) as unknown as Lean<Airline>[];
    const airports = (await this.airportModel
      .find({
        _id: {
          $in: flights.flatMap((flight) => [
            flight.departureAirport,
            flight.arrivalAirport,
          ]),
        },
      })
      .lean()) as unknown as Lean<Airport>[];
    const flightById = new Map(flights.map((f) => [f._id.toString(), f]));
    const airlineById = new Map(airlines.map((a) => [a._id.toString(), a]));
    const airportById = new Map(
      airports.map((a): [string, BookingViewAirport] => [
        a._id.toString(),
        { iataCode: a.iataCode, name: a.name, timezone: a.timezone },
      ]),
    );

    const legs: BookingViewLeg[] = [];
    booking.legs.forEach((leg, index) => {
      const flight = flightById.get(leg.flight.toString());
      const airline = flight && airlineById.get(flight.airline.toString());
      // An airline moderator only gets the legs their own airline operates.
      if (moderatorAirline && airline?._id.toString() !== moderatorAirline) {
        return;
      }
      legs.push({
        segment: index + 1,
        flightId: leg.flight.toString(),
        // A flight that vanished still shows its booked leg instead of hiding the booking.
        flightNumber: flight?.flightNumber ?? null,
        airline: airline
          ? {
              id: airline._id.toString(),
              name: airline.name,
              iataCode: airline.iataCode,
            }
          : null,
        flightStatus: flight?.status ?? null,
        departureAirport: flight
          ? (airportById.get(flight.departureAirport.toString()) ?? null)
          : null,
        arrivalAirport: flight
          ? (airportById.get(flight.arrivalAirport.toString()) ?? null)
          : null,
        cabinClass: leg.cabinClass,
        departureTime: leg.departureTime,
        arrivalTime: leg.arrivalTime,
        unitPrice: moderatorView ? null : leg.unitPrice,
        seatNumbers: [...(leg.seatNumbers ?? [])],
      });
    });

    return {
      id: booking._id.toString(),
      bookingReference: booking.bookingReference,
      status: effectiveStatus(booking.status, booking.holdExpiresAt, now),
      tripType: booking.tripType,
      holdExpiresAt: booking.holdExpiresAt ?? null,
      passengerCounts: {
        adults: booking.passengerCounts.adults,
        children: booking.passengerCounts.children,
        infants: booking.passengerCounts.infants,
        totalSeatsRequired: booking.passengerCounts.totalSeatsRequired,
      },
      passengers: booking.passengers.map((passenger) =>
        toViewPassenger(passenger, moderatorView),
      ),
      legs,
      baseFareTotal: moderatorView ? null : booking.baseFareTotal,
      extraBaggageTotal: moderatorView ? null : booking.extraBaggageTotal,
      taxesAndFees: moderatorView ? null : booking.taxesAndFees,
      totalPrice: moderatorView ? null : booking.totalPrice,
      currency: booking.currency,
      policies: moderatorView ? null : (booking.policySnapshot ?? null),
      policyAcceptedAt: moderatorView
        ? null
        : (booking.policyAcceptedAt ?? null),
      confirmedAt: booking.confirmedAt ?? null,
      cancelledAt: booking.cancelledAt ?? null,
      cancellationReason: booking.cancellationReason ?? null,
      refundAmount: moderatorView ? null : (booking.refundAmount ?? null),
      payment: moderatorView
        ? null
        : await this.paymentSummary(booking.payment),
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
    };
  }

  /** Status, amount and time of the booking's payment. Never card data or the client secret. */
  private async paymentSummary(
    paymentId: Types.ObjectId | null | undefined,
  ): Promise<BookingViewPayment | null> {
    if (!paymentId) return null;
    const payment = (await this.paymentModel
      .findById(paymentId)
      .lean()) as unknown as Lean<Payment> | null;
    if (!payment) return null;
    return {
      id: payment._id.toString(),
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      paidAt: payment.paidAt ?? null,
    };
  }
}
