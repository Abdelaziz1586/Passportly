import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BookingStatus, FlightStatus, Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { Airport } from '../reference-data/schemas/airport.schema';
import { loadReadableFlightBookingRaw } from './flight-booking-access';
import {
  ETicket,
  ETicketAirport,
  ETicketLeg,
  eTicketToPdfLines,
  toETicketPassenger,
  toEndpoint,
} from './flight-e-ticket';
import { buildSimplePdf } from './simple-pdf';
import { Airline } from './schemas/airline.schema';
import { FlightBooking } from './schemas/flight-booking.schema';
import { Flight } from './schemas/flight.schema';

type Lean<T> = T & { _id: Types.ObjectId };

/**
 * FLT-23: the e-ticket of a CONFIRMED flight booking, as a structured payload
 * (booking reference, passenger e-ticket numbers, airport time zones) and as a
 * downloadable PDF. Who may read it is decided by loadReadableFlightBooking.
 */
@Injectable()
export class FlightETicketService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    @InjectModel(Airport.name) private readonly airportModel: Model<Airport>,
  ) {}

  async getETicket(user: AuthenticatedUser, id: string): Promise<ETicket> {
    const booking = await loadReadableFlightBookingRaw(
      user,
      id,
      this.bookingModel,
      this.flightModel,
    );
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException(
        `An e-ticket is only available for a CONFIRMED booking (this one is ${booking.status})`,
      );
    }

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
    const cancelled = flights.find(
      (flight) => flight.status === FlightStatus.CANCELLED,
    );
    if (cancelled) {
      throw new ConflictException(
        `Flight ${cancelled.flightNumber} was cancelled: there is no e-ticket for it`,
      );
    }
    const flightById = new Map(flights.map((f) => [f._id.toString(), f]));
    const airlineById = new Map(airlines.map((a) => [a._id.toString(), a]));
    const airportById = new Map(
      airports.map((a): [string, ETicketAirport] => [
        a._id.toString(),
        {
          iataCode: a.iataCode,
          name: a.name,
          city: a.cityName ?? null,
          timezone: a.timezone,
        },
      ]),
    );

    // An airline moderator only sees the legs their own airline operates, and no price.
    const moderatorAirline =
      user.role === Role.AIRLINE_MODERATOR
        ? user.assignedProviderId
        : undefined;
    const visibleLegs = booking.legs
      .map((leg, index) => ({ leg, index }))
      .filter(({ leg }) => {
        if (!moderatorAirline) return true;
        const operator = flightById.get(leg.flight.toString())?.airline;
        return operator?.toString() === moderatorAirline;
      });

    const legs: ETicketLeg[] = visibleLegs.map(({ leg, index }) => {
      const flight = flightById.get(leg.flight.toString());
      const airline = flight && airlineById.get(flight.airline.toString());
      const from =
        flight && airportById.get(flight.departureAirport.toString());
      const to = flight && airportById.get(flight.arrivalAirport.toString());
      if (!flight || !airline || !from || !to) {
        throw new ConflictException(
          'A flight of this booking is no longer available to build the e-ticket',
        );
      }
      return {
        segment: index + 1,
        flightId: flight._id.toString(),
        flightNumber: flight.flightNumber,
        airline: {
          id: airline._id.toString(),
          name: airline.name,
          iataCode: airline.iataCode,
        },
        cabinClass: leg.cabinClass,
        // The booking keeps the times agreed at booking (also for the duration); the airports give the zones.
        durationMinutes: Math.round(
          (leg.arrivalTime.getTime() - leg.departureTime.getTime()) / 60_000,
        ),
        departure: toEndpoint(from, leg.departureTime),
        arrival: toEndpoint(to, leg.arrivalTime),
        seatNumbers: [...(leg.seatNumbers ?? [])],
      };
    });

    return {
      bookingId: booking._id.toString(),
      bookingReference: booking.bookingReference,
      status: booking.status,
      tripType: booking.tripType,
      issuedAt: booking.confirmedAt ?? null,
      passengers: booking.passengers.map((passenger) =>
        toETicketPassenger(passenger),
      ),
      legs,
      totalPrice: moderatorAirline ? null : booking.totalPrice,
      currency: booking.currency,
    };
  }

  toPdf(ticket: ETicket): Buffer {
    return buildSimplePdf(eTicketToPdfLines(ticket));
  }
}
