import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Connection, isValidObjectId, Model, Types } from 'mongoose';
import { BookingStatus, FlightStatus, PassengerType } from '../../common/enums';
import type {
  SeatMapResponseDto,
  SeatSelectionResponseDto,
} from './dto/seat-response.dto';
import { SelectSeatDto } from './dto/select-seat.dto';
import { CabinInventory } from './schemas/cabin-inventory.schema';
import { FlightBooking } from './schemas/flight-booking.schema';
import { FlightSeatClaim } from './schemas/flight-seat-claim.schema';
import { Flight } from './schemas/flight.schema';
import {
  buildSeatMap,
  formatSeat,
  isSeatInCabin,
  parseSeat,
  SEAT_LETTERS,
} from './seat-map';

type WithId = { _id: Types.ObjectId };
type StoredBooking = Omit<FlightBooking, 'legs' | 'passengers'> &
  WithId & {
    legs: Array<FlightBooking['legs'][number] & WithId>;
    passengers: Array<FlightBooking['passengers'][number] & WithId>;
  };
type StoredClaim = FlightSeatClaim & WithId;

const STALE_CLAIM_BATCH = 500;

/** A booking may receive seat changes while it is Confirmed or inside its hold. */
export function isBookingHoldingSeats(
  booking: { status: BookingStatus; holdExpiresAt?: Date | null },
  now: Date,
): boolean {
  if (booking.status === BookingStatus.CONFIRMED) return true;
  if (
    booking.status === BookingStatus.PENDING_PAYMENT ||
    booking.status === BookingStatus.HELD
  ) {
    return (
      !!booking.holdExpiresAt && booking.holdExpiresAt.getTime() > now.getTime()
    );
  }
  return false;
}

/**
 * A seat claim stays alive until its booking is in a terminal state. A hold
 * past its end is still alive until the expiry job flips it to Expired,
 * because the payment webhook can still confirm it in that window (paid in
 * time), and its seat must not be handed to somebody else meanwhile.
 */
export function isSeatClaimLive(booking: { status: BookingStatus }): boolean {
  return (
    booking.status === BookingStatus.CONFIRMED ||
    booking.status === BookingStatus.PENDING_PAYMENT ||
    booking.status === BookingStatus.HELD
  );
}

/**
 * FLT-28: seat selection. The owner picks one seat per non-infant passenger per
 * leg, from the passenger's own cabin, before that leg departs, on a booking
 * that is Confirmed or a live hold with passenger details. Seats cost nothing
 * and do not change the cabin inventory.
 *
 * Concurrency: the claim collection has a unique index on (flight, seat), so two
 * requests for one seat can never both succeed (the loser gets 409), and a unique
 * index on (booking, leg, passenger), so a passenger never holds two seats on a
 * leg. A claim and the display copies on the booking are written in ONE
 * transaction that also updates the booking document, so a concurrent
 * cancellation or expiry (which also writes the booking) conflicts with it and
 * is serialised.
 *
 * Release: a claim only counts while its booking is live (see isSeatClaimLive).
 * The seat map, the conflict check and a janitor job all treat the claims of
 * Cancelled, Expired and Completed bookings as free, so cancellation and expiry free the seats
 * without those flows having to know about seats.
 */
@Injectable()
export class FlightSeatsService {
  private readonly logger = new Logger(FlightSeatsService.name);
  private janitorRunning = false;
  private janitorCursor: Types.ObjectId | null = null;

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    @InjectModel(FlightSeatClaim.name)
    private readonly claimModel: Model<FlightSeatClaim>,
    @InjectModel(CabinInventory.name)
    private readonly cabinModel: Model<CabinInventory>,
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async selectSeat(
    userId: string,
    bookingId: string,
    dto: SelectSeatDto,
  ): Promise<SeatSelectionResponseDto> {
    const now = new Date();
    const booking = await this.loadOwnBooking(userId, bookingId);
    this.assertSelectable(booking, now);

    const legIndex = dto.legIndex ?? 0;
    const leg = booking.legs[legIndex];
    if (!leg) {
      throw new BadRequestException(
        `This booking has no leg ${legIndex} (it has ${booking.legs.length})`,
      );
    }
    const passenger = isValidObjectId(dto.passengerId)
      ? booking.passengers.find((p) => p._id.equals(dto.passengerId))
      : undefined;
    if (!passenger) {
      throw new NotFoundException('Passenger not found on this booking');
    }
    if (passenger.type === PassengerType.INFANT) {
      throw new BadRequestException(
        'An infant travels on a lap and takes no seat of its own',
      );
    }

    const flight = await this.flightModel
      .findById(leg.flight)
      .select('status departureTime')
      .lean();
    // Both the booking's copy and the flight's own time count (the airline may move a flight).
    const departure = flight
      ? Math.min(
          leg.departureTime.getTime(),
          flight.departureTime?.getTime() ?? Infinity,
        )
      : leg.departureTime.getTime();
    if (departure <= now.getTime()) {
      throw new ConflictException(
        'This flight has already departed: its seats can no longer be changed',
      );
    }
    if (!flight || flight.status === FlightStatus.CANCELLED) {
      throw new ConflictException(
        'This flight is cancelled: no seat can be chosen',
      );
    }

    const parsed = parseSeat(dto.seat);
    const cabins = await this.cabinModel.find({ flight: leg.flight }).lean();
    const layout = buildSeatMap(
      cabins.map((c) => ({
        cabinClass: c.cabinClass,
        totalSeats: c.totalSeats,
      })),
    ).find((c) => c.cabinClass === leg.cabinClass);
    if (!parsed || !layout || !isSeatInCabin(layout, parsed)) {
      throw new BadRequestException(
        layout
          ? `Seat ${dto.seat} does not exist in the ${leg.cabinClass} cabin of this flight (rows ${layout.firstRow}-${layout.lastRow}, letters A-F)`
          : 'The cabin of this leg was not found',
      );
    }
    const seat = formatSeat(parsed.row, parsed.letter);

    // A seat held by a booking that is no longer active is free: clear that claim first.
    const holder = await this.claimModel
      .findOne({ flight: leg.flight, seat })
      .lean<StoredClaim>();
    let previousSeat: string | null = null;
    if (holder) {
      const mine =
        holder.booking.equals(booking._id) &&
        holder.leg.equals(leg._id) &&
        holder.passenger.equals(passenger._id);
      if (mine) {
        return this.toResponse(booking, legIndex, passenger._id, seat, seat);
      }
      if (!(await this.freeIfStale(holder))) {
        throw new ConflictException(
          `Seat ${seat} is already taken: choose a different seat`,
        );
      }
    }

    try {
      previousSeat = await this.connection.transaction(async (session) => {
        const before = await this.claimModel.findOneAndUpdate(
          { booking: booking._id, leg: leg._id, passenger: passenger._id },
          {
            $set: { seat, cabin: leg.cabin, flight: leg.flight },
          },
          { upsert: true, returnDocument: 'before', session },
        );

        const claims = await this.claimModel
          .find({ booking: booking._id })
          .session(session)
          .lean<StoredClaim[]>();
        const sets: Record<string, string[]> = {};
        booking.legs.forEach((l, li) => {
          sets[`legs.${li}.seatNumbers`] = booking.passengers
            .map((p) =>
              claims.find(
                (c) => c.leg.equals(l._id) && c.passenger.equals(p._id),
              ),
            )
            .filter((c): c is StoredClaim => !!c)
            .map((c) => c.seat);
        });
        booking.passengers.forEach((p, pi) => {
          sets[`passengers.${pi}.seatAssignments`] = booking.legs
            .map((l) =>
              claims.find(
                (c) => c.leg.equals(l._id) && c.passenger.equals(p._id),
              ),
            )
            .filter((c): c is StoredClaim => !!c)
            .map((c) => c.seat);
        });

        // Guard and write-conflict point: the booking must still be active and the leg not departed.
        const guarded = await this.bookingModel.updateOne(
          {
            _id: booking._id,
            user: booking.user,
            $or: [
              { status: BookingStatus.CONFIRMED },
              {
                status: {
                  $in: [BookingStatus.PENDING_PAYMENT, BookingStatus.HELD],
                },
                holdExpiresAt: { $gt: now },
              },
            ],
            [`legs.${legIndex}.departureTime`]: { $gt: now },
            // The leg this seat was chosen for must still be the one on the booking (a flight change
            // in between replaces the leg, and its seats belong to the old flight).
            [`legs.${legIndex}._id`]: leg._id,
          },
          { $set: sets },
          { session },
        );
        if (guarded.matchedCount !== 1) {
          throw new ConflictException(
            'This booking can no longer receive seat changes (cancelled, expired or the flight has departed)',
          );
        }
        return before ? before.seat : null;
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          isSeatIndexError(error)
            ? `Seat ${seat} was just taken by another passenger: choose a different seat`
            : 'This passenger’s seat was changed at the same time: try again',
        );
      }
      throw error;
    }

    const fresh = await this.loadOwnBooking(userId, bookingId);
    return this.toResponse(fresh, legIndex, passenger._id, seat, previousSeat);
  }

  async getSeatMap(
    userId: string,
    bookingId: string,
  ): Promise<SeatMapResponseDto> {
    const now = new Date();
    const booking = await this.loadOwnBooking(userId, bookingId);
    const flightIds = booking.legs.map((l) => l.flight);
    const [flights, cabins, claims] = await Promise.all([
      this.flightModel
        .find({ _id: { $in: flightIds } })
        .select('flightNumber status departureTime')
        .lean(),
      this.cabinModel.find({ flight: { $in: flightIds } }).lean(),
      this.claimModel
        .find({ flight: { $in: flightIds } })
        .lean<StoredClaim[]>(),
    ]);
    const holderIds = [...new Set(claims.map((c) => c.booking.toString()))].map(
      (id) => new Types.ObjectId(id),
    );
    const holders = await this.bookingModel
      .find({ _id: { $in: holderIds } })
      .select('status holdExpiresAt')
      .lean();
    const active = new Set(
      holders.filter((h) => isSeatClaimLive(h)).map((h) => h._id.toString()),
    );

    return {
      bookingId: booking._id.toString(),
      bookingReference: booking.bookingReference,
      legs: booking.legs.map((leg, legIndex) => {
        const flight = flights.find((f) => f._id.equals(leg.flight));
        const layout = buildSeatMap(
          cabins
            .filter((c) => c.flight.equals(leg.flight))
            .map((c) => ({
              cabinClass: c.cabinClass,
              totalSeats: c.totalSeats,
            })),
        ).find((c) => c.cabinClass === leg.cabinClass);
        const live = claims.filter(
          (c) =>
            c.flight.equals(leg.flight) && active.has(c.booking.toString()),
        );
        const inCabin = (seat: string): boolean => {
          const parsed = parseSeat(seat);
          return !!parsed && !!layout && isSeatInCabin(layout, parsed);
        };
        return {
          legIndex,
          flightId: leg.flight.toString(),
          flightNumber: flight?.flightNumber ?? '',
          cabinClass: leg.cabinClass,
          seatLetters: [...SEAT_LETTERS],
          firstRow: layout?.firstRow ?? 0,
          lastRow: layout?.lastRow ?? 0,
          totalSeats: layout?.totalSeats ?? 0,
          takenSeats: live
            .filter((c) => inCabin(c.seat))
            .map((c) => c.seat)
            .sort(compareSeats),
          yourSeats: live
            .filter(
              (c) => c.booking.equals(booking._id) && c.leg.equals(leg._id),
            )
            .map((c) => ({
              passengerId: c.passenger.toString(),
              seat: c.seat,
            })),
          selectable:
            Math.min(
              leg.departureTime.getTime(),
              flight?.departureTime?.getTime() ?? Infinity,
            ) > now.getTime() &&
            !!flight &&
            flight.status !== FlightStatus.CANCELLED,
        };
      }),
    };
  }

  /** Janitor: removes the claims of bookings that are Cancelled, Expired or Completed (backs up the lazy checks). */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'flight-seat-claim-janitor' })
  async releaseStaleClaims(): Promise<number> {
    if (this.janitorRunning) return 0;
    this.janitorRunning = true;
    try {
      // Walk the collection in _id order, one slice per run, so old stale
      // claims are reached even when the first claims are all live.
      const slice = STALE_CLAIM_BATCH * 4;
      const claims = await this.claimModel
        .find(this.janitorCursor ? { _id: { $gt: this.janitorCursor } } : {})
        .sort({ _id: 1 })
        .select('booking')
        .limit(slice)
        .lean<Array<{ _id: Types.ObjectId; booking: Types.ObjectId }>>();
      this.janitorCursor =
        claims.length === slice ? claims[claims.length - 1]._id : null;
      if (claims.length === 0) return 0;
      const ids = [...new Set(claims.map((c) => c.booking.toString()))].map(
        (id) => new Types.ObjectId(id),
      );
      const holders = await this.bookingModel
        .find({ _id: { $in: ids } })
        .select('status holdExpiresAt')
        .lean();
      const active = new Set(
        holders.filter((h) => isSeatClaimLive(h)).map((h) => h._id.toString()),
      );
      const stale = claims
        .filter((c) => !active.has(c.booking.toString()))
        .slice(0, STALE_CLAIM_BATCH)
        .map((c) => c._id);
      if (stale.length === 0) return 0;
      // Safe to delete: a booking never comes back from Cancelled, Expired or
      // Completed.
      await this.claimModel.deleteMany({ _id: { $in: stale } });
      this.logger.log(
        `Released ${stale.length} seat claim(s) of inactive bookings`,
      );
      return stale.length;
    } catch (error) {
      this.logger.error(
        'Failed to release stale seat claims',
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    } finally {
      this.janitorRunning = false;
    }
  }

  /** Frees the claim if its booking holds no seats any more. Returns false when the seat is really taken. */
  private async freeIfStale(claim: StoredClaim): Promise<boolean> {
    const holder = await this.bookingModel
      .findById(claim.booking)
      .select('status holdExpiresAt')
      .lean();
    if (holder && isSeatClaimLive(holder)) return false;
    await this.claimModel.deleteOne({ _id: claim._id });
    return true;
  }

  /** The caller's own booking; someone else's looks exactly like a missing one. */
  private async loadOwnBooking(
    userId: string,
    bookingId: string,
  ): Promise<StoredBooking> {
    if (!isValidObjectId(bookingId) || !isValidObjectId(userId)) {
      throw new NotFoundException('Flight booking not found');
    }
    const booking = (await this.bookingModel
      .findOne({
        _id: new Types.ObjectId(bookingId),
        user: new Types.ObjectId(userId),
      })
      .lean()) as unknown as StoredBooking | null;
    if (!booking) throw new NotFoundException('Flight booking not found');
    return booking;
  }

  private assertSelectable(booking: StoredBooking, now: Date): void {
    if (!isBookingHoldingSeats(booking, now)) {
      throw new ConflictException(
        `A ${booking.status} booking cannot have seats chosen (it must be confirmed, or a live hold)`,
      );
    }
    if (booking.passengers.length === 0) {
      throw new ConflictException(
        'Submit the passenger details first: seats are chosen per passenger',
      );
    }
  }

  private toResponse(
    booking: StoredBooking,
    legIndex: number,
    passengerId: Types.ObjectId,
    seat: string,
    previousSeat: string | null,
  ): SeatSelectionResponseDto {
    const leg = booking.legs[legIndex];
    return {
      bookingId: booking._id.toString(),
      bookingReference: booking.bookingReference,
      legIndex,
      flightId: leg.flight.toString(),
      cabinClass: leg.cabinClass,
      passengerId: passengerId.toString(),
      seat,
      previousSeat: previousSeat === seat ? null : previousSeat,
      legSeats: [...(leg.seatNumbers ?? [])],
    };
  }
}

function compareSeats(a: string, b: string): number {
  const pa = parseSeat(a);
  const pb = parseSeat(b);
  if (!pa || !pb) return a.localeCompare(b);
  return pa.row - pb.row || pa.letter.localeCompare(pb.letter);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}

/** True when the duplicate key was on (flight, seat), not on (booking, leg, passenger). */
function isSeatIndexError(error: unknown): boolean {
  const pattern = (error as { keyPattern?: Record<string, unknown> })
    .keyPattern;
  return !!pattern && 'seat' in pattern;
}
