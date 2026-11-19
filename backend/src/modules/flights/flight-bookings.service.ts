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
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
  BookingStatus,
  CabinClass,
  FlightStatus,
  NotificationType,
  TripType,
} from '../../common/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { HoldSeatsDto } from './dto/hold-seats.dto';
import { Airline } from './schemas/airline.schema';
import { CabinInventory } from './schemas/cabin-inventory.schema';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';
import { Flight } from './schemas/flight.schema';

/** Hold length used when FLIGHT_HOLD_MINUTES is not set (see the requirements sheet). */
export const DEFAULT_HOLD_MINUTES = 15;
/** Most seats one booking may reserve (adults + children). */
export const MAX_SEATS_PER_BOOKING = 9;

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
    this.assertValidRequest(dto, seatsRequired);
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

  private assertValidRequest(dto: HoldSeatsDto, seatsRequired: number): void {
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
    if (seatsRequired > MAX_SEATS_PER_BOOKING) {
      throw new BadRequestException(
        `A booking can hold at most ${MAX_SEATS_PER_BOOKING} seats`,
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
    const infantFare = cabin.infantPrice ?? 0;
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
