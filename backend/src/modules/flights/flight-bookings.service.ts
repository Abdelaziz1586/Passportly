import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomInt } from 'crypto';
import {
  ClientSession,
  Connection,
  isValidObjectId,
  Model,
  Types,
} from 'mongoose';
import {
  BookingStatus,
  CabinClass,
  FlightStatus,
  NotificationType,
  PassengerType,
  TripType,
} from '../../common/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateFlightBookingDto } from './dto/create-flight-booking.dto';
import { HoldSeatsDto } from './dto/hold-seats.dto';
import {
  assertExtraBagWeights,
  buildPolicySnapshot,
  calculateBaggageFees,
  FlightPolicySnapshot,
  maskPassport,
  normalizePassengers,
  PolicyLegSource,
  toCents,
} from './flight-booking-details';
import { Airline } from './schemas/airline.schema';
import { CabinInventory } from './schemas/cabin-inventory.schema';
import {
  FlightBooking,
  FlightBookingDocument,
  Passenger,
} from './schemas/flight-booking.schema';
import { Flight } from './schemas/flight.schema';

/** Hold length in minutes (requirements sheet: 10), fixed from hold creation and never extended. */
export const DEFAULT_HOLD_MINUTES = 10;
/** Infants take no seat and pay this share of the cabin fare on every leg. */
export const INFANT_FARE_RATE = 0.1;

const BOOKING_REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BOOKING_REFERENCE_LENGTH = 8;
const MAX_REFERENCE_ATTEMPTS = 3;
const EXPIRY_BATCH_SIZE = 100;
const BOOKABLE_FLIGHT_STATUSES: FlightStatus[] = [
  FlightStatus.SCHEDULED,
  FlightStatus.DELAYED,
];
const ACTIVE_HOLD_STATUSES: BookingStatus[] = [
  BookingStatus.HELD,
  BookingStatus.PENDING_PAYMENT,
];

export interface FlightHoldLegResponse {
  flightId: string;
  cabinClass: CabinClass;
  departureTime: Date;
  arrivalTime: Date;
  unitPrice: number;
}

export interface FlightHoldResponse {
  id: string;
  bookingReference: string;
  status: BookingStatus;
  tripType: TripType;
  holdExpiresAt: Date;
  passengerCounts: {
    adults: number;
    children: number;
    infants: number;
    totalSeatsRequired: number;
  };
  legs: FlightHoldLegResponse[];
  baseFareTotal: number;
  totalPrice: number;
  currency: string;
}

export interface FlightBookingPassengerResponse {
  id: string | null;
  firstName: string;
  lastName: string;
  type: PassengerType;
  dateOfBirth: Date | null;
  gender: string | null;
  /** Masked: only the last 4 characters are returned. */
  passportNumber: string;
  passportExpiry: Date | null;
  nationality: string | null;
  extraBaggageCount: number;
  extraBaggageFee: number;
}

export interface FlightBookingResponse {
  id: string;
  bookingReference: string;
  status: BookingStatus;
  tripType: TripType;
  holdExpiresAt: Date;
  passengerCounts: {
    adults: number;
    children: number;
    infants: number;
    totalSeatsRequired: number;
  };
  passengers: FlightBookingPassengerResponse[];
  legs: FlightHoldLegResponse[];
  baseFareTotal: number;
  extraBaggageTotal: number;
  taxesAndFees: number;
  totalPrice: number;
  currency: string;
  /** Baggage and cancellation policies the user must accept before paying. */
  policies: FlightPolicySnapshot;
}

interface HoldCandidate {
  flight: Flight & { _id: Types.ObjectId };
  cabin: CabinInventory & { _id: Types.ObjectId };
}

@Injectable()
export class FlightBookingsService {
  private readonly logger = new Logger(FlightBookingsService.name);
  private expiryRunning = false;

  constructor(
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
    @InjectModel(CabinInventory.name)
    private readonly cabinModel: Model<CabinInventory>,
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    @InjectConnection() private readonly connection: Connection,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * FLT-22: temporarily reserve seats on every leg of a trip.
   *
   * All legs and the HELD booking are written in one transaction, and each
   * seat decrement is a conditional update (availableSeats >= seatsRequired),
   * so concurrent requests can never oversell a cabin.
   */
  async holdSeats(
    userId: string,
    dto: HoldSeatsDto,
  ): Promise<FlightHoldResponse> {
    const seatsRequired = dto.adults + dto.children;
    this.assertValidRequest(dto);
    const holdMinutes = this.getHoldMinutes();

    for (let attempt = 1; attempt <= MAX_REFERENCE_ATTEMPTS; attempt++) {
      try {
        const booking = await this.connection.transaction((session) =>
          this.createHold(userId, dto, seatsRequired, holdMinutes, session),
        );
        return this.toHoldResponse(booking);
      } catch (error) {
        // A random reference collided with an existing one: try a new one.
        if (
          this.isDuplicateReferenceError(error) &&
          attempt < MAX_REFERENCE_ATTEMPTS
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new InternalServerErrorException(
      'Could not generate a unique booking reference',
    );
  }

  /**
   * FLT-19, FLT-21: attach passenger and baggage details to a HELD booking,
   * price the extras, snapshot the airline policies and move the booking to
   * PENDING_PAYMENT (never CONFIRMED: only a verified payment may do that).
   *
   * The state change is one conditional update (owner + HELD + hold not yet
   * expired), so it cannot race with the expiry cron or a double submit.
   * holdExpiresAt is deliberately left untouched.
   */
  async createBooking(
    userId: string,
    dto: CreateFlightBookingDto,
  ): Promise<FlightBookingResponse> {
    if (!isValidObjectId(dto.bookingId) || !isValidObjectId(userId)) {
      throw new NotFoundException('Flight booking not found');
    }
    const now = new Date();
    const bookingId = new Types.ObjectId(dto.bookingId);
    const owner = new Types.ObjectId(userId);

    // Ownership: someone else's booking looks exactly like a missing one.
    const booking = await this.bookingModel.findOne({
      _id: bookingId,
      user: owner,
    });
    if (!booking) throw new NotFoundException('Flight booking not found');
    this.assertAwaitingDetails(booking, now);

    const lastLeg = booking.legs[booking.legs.length - 1];
    const passengers = normalizePassengers(
      dto.passengers,
      booking.passengerCounts,
      booking.legs[0].departureTime,
      lastLeg.arrivalTime,
      now,
    );

    const legSources = await this.loadPolicySources(booking, now);
    assertExtraBagWeights(passengers, legSources);
    const fees = calculateBaggageFees(
      passengers,
      legSources.map(({ airline }) => airline.baggagePolicy),
      booking.currency,
    );
    const snapshot = buildPolicySnapshot(legSources, now);

    const baseCents = toCents(booking.baseFareTotal);
    const taxesCents = toCents(booking.taxesAndFees ?? 0);
    const extraBaggageTotal = fees.totalCents / 100;
    const totalPrice = (baseCents + fees.totalCents + taxesCents) / 100;

    const updated = await this.bookingModel.findOneAndUpdate(
      {
        _id: bookingId,
        user: owner,
        status: BookingStatus.HELD,
        holdExpiresAt: { $gt: now },
      },
      {
        $set: {
          passengers: passengers.map((passenger, index) => ({
            ...passenger,
            extraBaggageFee: fees.perPassengerCents[index] / 100,
          })),
          extraBaggageTotal,
          taxesAndFees: taxesCents / 100,
          totalPrice,
          policySnapshot: snapshot,
          status: BookingStatus.PENDING_PAYMENT,
        },
      },
      { returnDocument: 'after' },
    );
    if (!updated) {
      // Another request submitted first, or the hold ran out in the meantime.
      throw new ConflictException(
        'This booking can no longer receive passenger details (already submitted or the seat hold expired)',
      );
    }
    return this.toBookingResponse(updated, snapshot);
  }

  private assertAwaitingDetails(booking: FlightBookingDocument, now: Date) {
    if (booking.status === BookingStatus.PENDING_PAYMENT) {
      throw new ConflictException(
        'Passenger details were already submitted for this booking',
      );
    }
    if (booking.status !== BookingStatus.HELD) {
      throw new ConflictException(
        `A ${booking.status} booking cannot receive passenger details`,
      );
    }
    if (
      !booking.holdExpiresAt ||
      booking.holdExpiresAt.getTime() <= now.getTime()
    ) {
      throw new ConflictException(
        'The seat hold has expired; place a new hold to continue',
      );
    }
  }

  /** Loads flight, airline and cabin of every leg and re-checks they are still bookable. */
  private async loadPolicySources(
    booking: FlightBookingDocument,
    now: Date,
  ): Promise<PolicyLegSource[]> {
    const flights = await this.flightModel.find({
      _id: { $in: booking.legs.map((leg) => leg.flight) },
    });
    const airlines = await this.airlineModel.find({
      _id: { $in: flights.map((flight) => flight.airline) },
    });
    const cabins = await this.cabinModel.find({
      _id: { $in: booking.legs.map((leg) => leg.cabin) },
    });
    const flightById = new Map(flights.map((f) => [f._id.toString(), f]));
    const airlineById = new Map(airlines.map((a) => [a._id.toString(), a]));
    const cabinById = new Map(cabins.map((c) => [c._id.toString(), c]));

    return booking.legs.map((leg) => {
      const flight = flightById.get(leg.flight.toString());
      const airline = flight && airlineById.get(flight.airline.toString());
      const cabin = cabinById.get(leg.cabin.toString());
      if (!flight || !airline || !cabin) {
        throw new ConflictException(
          'A flight in this booking is no longer available',
        );
      }
      if (
        !BOOKABLE_FLIGHT_STATUSES.includes(flight.status) ||
        flight.departureTime.getTime() <= now.getTime()
      ) {
        throw new ConflictException(
          `Flight ${flight.flightNumber} can no longer be booked (${flight.status})`,
        );
      }
      if (!airline.isActive) {
        throw new ConflictException(
          `The airline for flight ${flight.flightNumber} is not accepting bookings`,
        );
      }
      return { flightId: flight._id.toString(), airline, cabin };
    });
  }

  private toBookingResponse(
    booking: FlightBookingDocument,
    snapshot: FlightPolicySnapshot,
  ): FlightBookingResponse {
    // Built field by field on purpose: spreading a Mongoose subdocument leaks
    // internals (even the transaction session) into the JSON response.
    return {
      id: booking._id.toString(),
      bookingReference: booking.bookingReference,
      status: booking.status,
      tripType: booking.tripType,
      holdExpiresAt: booking.holdExpiresAt as Date,
      passengerCounts: {
        adults: booking.passengerCounts.adults,
        children: booking.passengerCounts.children,
        infants: booking.passengerCounts.infants,
        totalSeatsRequired: booking.passengerCounts.totalSeatsRequired,
      },
      passengers: booking.passengers.map((passenger) =>
        this.toPassengerResponse(passenger),
      ),
      legs: booking.legs.map((leg) => ({
        flightId: leg.flight.toString(),
        cabinClass: leg.cabinClass,
        departureTime: leg.departureTime,
        arrivalTime: leg.arrivalTime,
        unitPrice: leg.unitPrice,
      })),
      baseFareTotal: booking.baseFareTotal,
      extraBaggageTotal: booking.extraBaggageTotal,
      taxesAndFees: booking.taxesAndFees,
      totalPrice: booking.totalPrice,
      currency: booking.currency,
      policies: snapshot,
    };
  }

  private toPassengerResponse(
    passenger: Passenger,
  ): FlightBookingPassengerResponse {
    const { _id } = passenger as Passenger & { _id?: Types.ObjectId };
    return {
      id: _id ? _id.toString() : null,
      firstName: passenger.firstName,
      lastName: passenger.lastName,
      type: passenger.type,
      dateOfBirth: passenger.dateOfBirth ?? null,
      gender: passenger.gender ?? null,
      passportNumber: maskPassport(passenger.passportNumber),
      passportExpiry: passenger.passportExpiry ?? null,
      nationality: passenger.nationality ?? null,
      extraBaggageCount: passenger.extraBaggageCount,
      extraBaggageFee: passenger.extraBaggageFee,
    };
  }

  /**
   * Releases seats from holds whose time ran out. Each hold is claimed with a
   * conditional status flip inside the same transaction that returns its
   * seats, so running twice (or on two instances) never releases seats twice.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'flight-hold-expiry' })
  async expireStaleHolds(): Promise<number> {
    if (this.expiryRunning) return 0;
    this.expiryRunning = true;
    try {
      const now = new Date();
      const stale = await this.bookingModel
        .find({
          status: { $in: ACTIVE_HOLD_STATUSES },
          holdExpiresAt: { $lte: now },
        })
        .select('_id')
        .limit(EXPIRY_BATCH_SIZE)
        .lean();

      let expired = 0;
      for (const { _id } of stale) {
        try {
          if (await this.expireHold(_id, now)) expired++;
        } catch (error) {
          this.logger.error(
            `Failed to expire flight hold ${_id.toString()}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
      if (expired > 0) {
        this.logger.log(`Expired ${expired} flight hold(s)`);
      }
      return expired;
    } finally {
      this.expiryRunning = false;
    }
  }

  /** Expires one hold and returns its seats. Returns false if it was already handled. */
  async expireHold(bookingId: Types.ObjectId, now: Date): Promise<boolean> {
    const expired = await this.connection.transaction(async (session) => {
      const booking = await this.bookingModel.findOneAndUpdate(
        {
          _id: bookingId,
          status: { $in: ACTIVE_HOLD_STATUSES },
          holdExpiresAt: { $lte: now },
        },
        { $set: { status: BookingStatus.EXPIRED } },
        { returnDocument: 'after', session },
      );
      if (!booking) return null;

      const seats = booking.passengerCounts.totalSeatsRequired;
      for (const leg of booking.legs) {
        const released = await this.cabinModel.updateOne(
          { _id: leg.cabin, heldSeats: { $gte: seats } },
          { $inc: { heldSeats: -seats, availableSeats: seats } },
          { session },
        );
        if (released.modifiedCount !== 1) {
          this.logger.warn(
            `Cabin ${leg.cabin.toString()} had fewer than ${seats} held seats while expiring ${booking.bookingReference}`,
          );
        }
      }
      return booking;
    });

    if (!expired) return false;
    await this.notifyHoldExpired(expired);
    return true;
  }

  private assertValidRequest(dto: HoldSeatsDto): void {
    const expectedLegs = dto.tripType === TripType.ROUND_TRIP ? 2 : 1;
    if (dto.legs.length !== expectedLegs) {
      throw new BadRequestException(
        `${dto.tripType} bookings need exactly ${expectedLegs} flight leg(s)`,
      );
    }
    if (dto.infants > dto.adults) {
      throw new BadRequestException(
        'Each infant must travel with an adult (infants cannot exceed adults)',
      );
    }
    const flightIds = new Set(dto.legs.map((leg) => leg.flightId));
    if (flightIds.size !== dto.legs.length) {
      throw new BadRequestException('Each leg must use a different flight');
    }
  }

  private async createHold(
    userId: string,
    dto: HoldSeatsDto,
    seatsRequired: number,
    holdMinutes: number,
    session: ClientSession,
  ): Promise<FlightBookingDocument> {
    const now = new Date();

    // Phase 1: load and validate every leg before touching inventory.
    const candidates: HoldCandidate[] = [];
    for (const leg of dto.legs) {
      candidates.push(
        await this.loadCandidate(leg.flightId, leg.cabinClass, now, session),
      );
    }
    this.assertTripShape(dto.tripType, candidates);

    const currency = candidates[0].cabin.currency;
    if (candidates.some(({ cabin }) => cabin.currency !== currency)) {
      throw new BadRequestException(
        'Round-trip legs must be priced in the same currency',
      );
    }

    // Phase 2: take the seats. Conditional update = no overselling.
    for (const { cabin } of candidates) {
      const held = await this.cabinModel.findOneAndUpdate(
        {
          _id: cabin._id,
          isActive: true,
          availableSeats: { $gte: seatsRequired },
        },
        { $inc: { availableSeats: -seatsRequired, heldSeats: seatsRequired } },
        { returnDocument: 'after', session },
      );
      if (!held) {
        throw new ConflictException(
          `Not enough ${cabin.cabinClass} seats available (needed ${seatsRequired})`,
        );
      }
    }

    const legs = candidates.map(({ flight, cabin }) => ({
      flight: flight._id,
      cabin: cabin._id,
      cabinClass: cabin.cabinClass,
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      unitPrice: cabin.basePrice,
      seatNumbers: [],
    }));
    const baseFareTotal = this.round2(
      candidates.reduce(
        (sum, { cabin }) => sum + this.calculateLegFare(cabin, dto),
        0,
      ),
    );

    const [booking] = await this.bookingModel.create(
      [
        {
          bookingReference: this.generateReference(),
          user: new Types.ObjectId(userId),
          tripType: dto.tripType,
          legs,
          passengers: [],
          passengerCounts: {
            adults: dto.adults,
            children: dto.children,
            infants: dto.infants,
            totalSeatsRequired: seatsRequired,
          },
          baseFareTotal,
          extraBaggageTotal: 0,
          taxesAndFees: 0,
          totalPrice: baseFareTotal,
          currency,
          status: BookingStatus.HELD,
          holdExpiresAt: new Date(now.getTime() + holdMinutes * 60_000),
        },
      ],
      { session },
    );
    return booking;
  }

  private async loadCandidate(
    flightId: string,
    cabinClass: CabinClass,
    now: Date,
    session: ClientSession,
  ): Promise<HoldCandidate> {
    const flight = await this.flightModel.findById(flightId).session(session);
    if (!flight) {
      throw new NotFoundException(`Flight ${flightId} not found`);
    }
    if (!BOOKABLE_FLIGHT_STATUSES.includes(flight.status)) {
      throw new ConflictException(
        `Flight ${flight.flightNumber} is ${flight.status} and cannot be booked`,
      );
    }
    if (flight.departureTime.getTime() <= now.getTime()) {
      throw new ConflictException(
        `Flight ${flight.flightNumber} has already departed`,
      );
    }

    const airline = await this.airlineModel
      .findById(flight.airline)
      .session(session);
    if (!airline?.isActive) {
      throw new ConflictException(
        `The airline for flight ${flight.flightNumber} is not accepting bookings`,
      );
    }

    const cabin = await this.cabinModel
      .findOne({ flight: flight._id, cabinClass, isActive: true })
      .session(session);
    if (!cabin) {
      throw new NotFoundException(
        `${cabinClass} cabin is not offered on flight ${flight.flightNumber}`,
      );
    }
    return { flight, cabin };
  }

  /** Round trips must return from where the outbound landed, after it landed. */
  private assertTripShape(
    tripType: TripType,
    candidates: HoldCandidate[],
  ): void {
    if (tripType !== TripType.ROUND_TRIP) return;
    const [outbound, inbound] = candidates.map(({ flight }) => flight);
    const reverseRoute =
      outbound.arrivalAirport.equals(inbound.departureAirport) &&
      outbound.departureAirport.equals(inbound.arrivalAirport);
    if (!reverseRoute) {
      throw new BadRequestException(
        'The return flight must fly the outbound route in reverse',
      );
    }
    if (inbound.departureTime.getTime() <= outbound.arrivalTime.getTime()) {
      throw new BadRequestException(
        'The return flight must depart after the outbound flight arrives',
      );
    }
  }

  private calculateLegFare(cabin: CabinInventory, dto: HoldSeatsDto): number {
    const adultFare = cabin.basePrice;
    const childFare = cabin.childPrice ?? cabin.basePrice;
    // Infants pay 10% of the cabin fare per leg (they take no seat).
    const infantFare = this.round2(cabin.basePrice * INFANT_FARE_RATE);
    return (
      dto.adults * adultFare +
      dto.children * childFare +
      dto.infants * infantFare
    );
  }

  private async notifyHoldExpired(booking: FlightBookingDocument) {
    try {
      await this.notificationsService.createNotification({
        recipient: booking.user,
        type: NotificationType.BOOKING_HOLD_EXPIRED,
        title: 'Seat hold expired',
        message: `Your seat hold for booking ${booking.bookingReference} expired and the seats were released. Search again to rebook.`,
        relatedEntityType: 'FlightBooking',
        relatedEntityId: booking._id,
      });
    } catch (error) {
      // The hold is already released; a failed notification must not undo that.
      this.logger.error(
        `Could not notify user about expired hold ${booking.bookingReference}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private toHoldResponse(booking: FlightBookingDocument): FlightHoldResponse {
    return {
      id: booking._id.toString(),
      bookingReference: booking.bookingReference,
      status: booking.status,
      tripType: booking.tripType,
      holdExpiresAt: booking.holdExpiresAt as Date,
      // Copy field by field: spreading the nested path leaks Mongoose internals
      // (including the transaction session) into the JSON response.
      passengerCounts: {
        adults: booking.passengerCounts.adults,
        children: booking.passengerCounts.children,
        infants: booking.passengerCounts.infants,
        totalSeatsRequired: booking.passengerCounts.totalSeatsRequired,
      },
      legs: booking.legs.map((leg) => ({
        flightId: leg.flight.toString(),
        cabinClass: leg.cabinClass,
        departureTime: leg.departureTime,
        arrivalTime: leg.arrivalTime,
        unitPrice: leg.unitPrice,
      })),
      baseFareTotal: booking.baseFareTotal,
      totalPrice: booking.totalPrice,
      currency: booking.currency,
    };
  }

  private getHoldMinutes(): number {
    const configured = Number(
      this.configService.get<string | number>('FLIGHT_HOLD_MINUTES') ??
        DEFAULT_HOLD_MINUTES,
    );
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_HOLD_MINUTES;
  }

  private generateReference(): string {
    let reference = '';
    for (let i = 0; i < BOOKING_REFERENCE_LENGTH; i++) {
      reference +=
        BOOKING_REFERENCE_ALPHABET[
          randomInt(BOOKING_REFERENCE_ALPHABET.length)
        ];
    }
    return reference;
  }

  private isDuplicateReferenceError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const { code, keyPattern } = error as {
      code?: number;
      keyPattern?: Record<string, unknown>;
    };
    return code === 11000 && keyPattern?.bookingReference !== undefined;
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
