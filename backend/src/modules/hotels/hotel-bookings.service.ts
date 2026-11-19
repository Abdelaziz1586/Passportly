import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomInt } from 'crypto';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { BookingStatus, NotificationType } from '../../common/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import {
  nightsBetween,
  parseStayDate,
  startOfUtcDay,
  stayNights,
} from './hotel-booking-dates';
import {
  buildHotelPolicySnapshot,
  HotelPolicySnapshot,
  HotelPolicySource,
} from './hotel-booking-policy';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';
import { Hotel } from './schemas/hotel.schema';
import { RoomAvailability } from './schemas/room-availability.schema';
import { Room } from './schemas/room.schema';

/** HTL-18: the hold lasts 10 minutes from the request and is never extended. */
export const HOTEL_HOLD_MINUTES = 10;
/** Technical bound on one reservation's stay, so one request cannot open a huge transaction. */
export const MAX_STAY_NIGHTS = 90;

const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REFERENCE_LENGTH = 8;
const MAX_REFERENCE_ATTEMPTS = 3;
const EXPIRY_BATCH_SIZE = 100;
const ACTIVE_HOLD_STATUSES: BookingStatus[] = [
  BookingStatus.HELD,
  BookingStatus.PENDING_PAYMENT,
];

export interface HotelReservedRoomResponse {
  roomId: string;
  roomName: string;
  adults: number;
  childrenAges: number[];
  guestCount: number;
  nights: number;
  averagePricePerNight: number;
  subtotal: number;
}

export interface HotelBookingResponse {
  id: string;
  bookingReference: string;
  status: BookingStatus;
  hotelId: string;
  hotelName: string;
  checkInDate: Date;
  checkOutDate: Date;
  nights: number;
  holdExpiresAt: Date | null;
  rooms: HotelReservedRoomResponse[];
  guestCount: number;
  primaryGuestName: string;
  primaryGuestEmail: string;
  primaryGuestPhone: string | null;
  specialRequests: string | null;
  totalPrice: number;
  currency: string;
  /** Check-in/check-out times and cancellation tiers of the hotel, as accepted at booking time. */
  policies: HotelPolicySnapshot;
  createdAt: Date;
}

type Lean<T> = T & { _id: Types.ObjectId };

interface PricedRoom {
  room: Lean<Room>;
  adults: number;
  childrenAges: number[];
  subtotal: number;
  rows: Lean<RoomAvailability>[];
}

/**
 * HTL-16, HTL-18: one reservation for one or more rooms of the same hotel and
 * dates. Everything (every room, every night) is held in ONE transaction: if any
 * night of any room is unavailable, blocked, or already held/booked, nothing is
 * held. The reservation is PENDING_PAYMENT for 10 minutes and then EXPIRED, which
 * releases the rooms. The total is the sum over rooms of the nights x that room's
 * price at booking time.
 */
@Injectable()
export class HotelBookingsService {
  private readonly logger = new Logger(HotelBookingsService.name);
  private expiryRunning = false;

  constructor(
    @InjectModel(Hotel.name) private readonly hotelModel: Model<Hotel>,
    @InjectModel(Room.name) private readonly roomModel: Model<Room>,
    @InjectModel(RoomAvailability.name)
    private readonly availabilityModel: Model<RoomAvailability>,
    @InjectModel(HotelBooking.name)
    private readonly bookingModel: Model<HotelBooking>,
    @InjectConnection() private readonly connection: Connection,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createBooking(
    userId: string,
    dto: CreateHotelBookingDto,
  ): Promise<HotelBookingResponse> {
    const now = new Date();
    const { checkIn, checkOut, nights } = this.validateRequest(dto, now);

    const hotel = (await this.hotelModel
      .findById(dto.hotelId)
      .lean()) as unknown as (Lean<Hotel> & HotelPolicySource) | null;
    if (!hotel) throw new NotFoundException('Hotel not found');
    if (!hotel.isActive) {
      throw new ConflictException('This hotel is not accepting bookings');
    }

    const roomIds = dto.rooms.map(
      (selection) => new Types.ObjectId(selection.roomId),
    );
    const rooms = (await this.roomModel
      .find({ _id: { $in: roomIds }, hotel: hotel._id, isActive: true })
      .lean()) as unknown as Lean<Room>[];
    const roomById = new Map(rooms.map((room) => [room._id.toString(), room]));
    const selections = dto.rooms.map((selection) => {
      const room = roomById.get(selection.roomId);
      if (!room) {
        throw new NotFoundException(
          `Room ${selection.roomId} was not found in this hotel`,
        );
      }
      const childrenAges = selection.childrenAges ?? [];
      const guests = selection.adults + childrenAges.length;
      if (guests > room.maxOccupancy) {
        throw new BadRequestException(
          `Room ${room.name} sleeps at most ${room.maxOccupancy} (${guests} assigned)`,
        );
      }
      return { room, adults: selection.adults, childrenAges };
    });
    const currencies = new Set(selections.map(({ room }) => room.currency));
    if (currencies.size > 1) {
      throw new BadRequestException(
        'All rooms of one reservation must be priced in the same currency',
      );
    }

    for (let attempt = 1; attempt <= MAX_REFERENCE_ATTEMPTS; attempt++) {
      try {
        const booking = await this.connection.transaction((session) =>
          this.createHold(
            userId,
            dto,
            hotel,
            selections,
            { checkIn, checkOut, nights },
            now,
            session,
          ),
        );
        return this.toResponse(booking, hotel);
      } catch (error) {
        // A random reference collided with an existing one: try a new one.
        if (
          this.isDuplicateReference(error) &&
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

  private validateRequest(dto: CreateHotelBookingDto, now: Date) {
    const checkIn = parseStayDate(dto.checkInDate);
    const checkOut = parseStayDate(dto.checkOutDate);
    if (!checkIn || !checkOut) {
      throw new BadRequestException(
        'checkInDate and checkOutDate must be real dates (YYYY-MM-DD)',
      );
    }
    if (checkOut.getTime() <= checkIn.getTime()) {
      throw new BadRequestException('Check-out must be after check-in');
    }
    if (checkIn.getTime() < startOfUtcDay(now).getTime()) {
      throw new BadRequestException('Check-in cannot be in the past');
    }
    const nights = nightsBetween(checkIn, checkOut);
    if (nights > MAX_STAY_NIGHTS) {
      throw new BadRequestException(
        `A stay can be at most ${MAX_STAY_NIGHTS} nights`,
      );
    }
    const roomIds = dto.rooms.map((selection) => selection.roomId);
    if (new Set(roomIds).size !== roomIds.length) {
      throw new BadRequestException('Each room can only be selected once');
    }
    let adults = 0;
    for (const selection of dto.rooms) {
      const guests = selection.adults + (selection.childrenAges?.length ?? 0);
      if (guests < 1) {
        throw new BadRequestException(
          'Every selected room needs at least one guest',
        );
      }
      adults += selection.adults;
    }
    if (adults < 1) {
      throw new BadRequestException('A reservation needs at least one adult');
    }
    return { checkIn, checkOut, nights };
  }

  /** The transaction body: price every room, hold every night, write the PENDING_PAYMENT reservation. */
  private async createHold(
    userId: string,
    dto: CreateHotelBookingDto,
    hotel: Lean<Hotel> & HotelPolicySource,
    selections: { room: Lean<Room>; adults: number; childrenAges: number[] }[],
    stay: { checkIn: Date; checkOut: Date; nights: number },
    now: Date,
    session: ClientSession,
  ): Promise<HotelBookingDocument> {
    const nightDates = stayNights(stay.checkIn, stay.nights);
    const priced: PricedRoom[] = [];

    // Phase 1: every night of every room must exist, be open, and be priced.
    for (const selection of selections) {
      const rows = (await this.availabilityModel
        .find({ room: selection.room._id, date: { $in: nightDates } })
        .session(session)
        .lean()) as unknown as Lean<RoomAvailability>[];
      const byDate = new Map(rows.map((row) => [row.date.getTime(), row]));
      let subtotalCents = 0;
      for (const night of nightDates) {
        const row = byDate.get(night.getTime());
        if (!row || row.isBlocked) {
          throw new ConflictException(
            `Room ${selection.room.name} is not available for the whole stay`,
          );
        }
        subtotalCents += Math.round(
          (row.priceOverride ?? selection.room.basePricePerNight) * 100,
        );
      }
      priced.push({
        room: selection.room,
        adults: selection.adults,
        childrenAges: selection.childrenAges,
        subtotal: subtotalCents / 100,
        rows,
      });
    }

    // Phase 2: take the units. A conditional update per night, so concurrent requests
    // can never hold more than totalUnits; any failure aborts the whole transaction.
    for (const { room, rows } of priced) {
      for (const row of rows) {
        const held = await this.availabilityModel.updateOne(
          {
            _id: row._id,
            isBlocked: false,
            $expr: {
              $lte: [
                { $add: ['$bookedUnits', '$heldUnits', 1] },
                '$totalUnits',
              ],
            },
          },
          { $inc: { heldUnits: 1 } },
          { session },
        );
        if (held.modifiedCount !== 1) {
          throw new ConflictException(
            `Room ${room.name} is no longer available for the whole stay`,
          );
        }
      }
    }

    const roomItems = priced.map(
      ({ room, adults, childrenAges, subtotal }) => ({
        room: room._id,
        roomName: room.name,
        quantity: 1,
        averagePricePerNight: this.round2(subtotal / stay.nights),
        nights: stay.nights,
        subtotal,
        guestCount: adults + childrenAges.length,
        adults,
        childrenAges,
      }),
    );
    const totalPrice = this.round2(
      roomItems.reduce((sum, item) => sum + item.subtotal, 0),
    );
    const [booking] = await this.bookingModel.create(
      [
        {
          bookingReference: this.generateReference(),
          user: new Types.ObjectId(userId),
          hotel: hotel._id,
          rooms: roomItems,
          checkInDate: stay.checkIn,
          checkOutDate: stay.checkOut,
          nights: stay.nights,
          guestCount: roomItems.reduce((sum, item) => sum + item.guestCount, 0),
          primaryGuestName: dto.primaryGuestName,
          primaryGuestEmail: dto.primaryGuestEmail,
          primaryGuestPhone: dto.primaryGuestPhone,
          specialRequests: dto.specialRequests,
          totalPrice,
          currency: priced[0].room.currency,
          status: BookingStatus.PENDING_PAYMENT,
          holdExpiresAt: new Date(now.getTime() + HOTEL_HOLD_MINUTES * 60_000),
          policySnapshot: buildHotelPolicySnapshot(hotel, now),
        },
      ],
      { session },
    );
    return booking;
  }

  /**
   * Releases the rooms of holds whose time ran out. Each hold is claimed with a
   * conditional status flip inside the same transaction that returns its units,
   * so running twice (or on two instances) never releases anything twice.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'hotel-hold-expiry' })
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
            `Failed to expire hotel hold ${_id.toString()}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
      if (expired > 0) this.logger.log(`Expired ${expired} hotel hold(s)`);
      return expired;
    } finally {
      this.expiryRunning = false;
    }
  }

  /** Expires one hold and releases its rooms. Returns false if it was already handled. */
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
      await this.releaseHeldUnits(booking, session);
      return booking;
    });
    if (!expired) return false;
    try {
      await this.notificationsService.createNotification({
        recipient: expired.user,
        type: NotificationType.BOOKING_HOLD_EXPIRED,
        title: 'Room hold expired',
        message: `Your hold for reservation ${expired.bookingReference} expired and the rooms were released. Search again to rebook.`,
        relatedEntityType: 'HotelBooking',
        relatedEntityId: expired._id,
      });
    } catch (error) {
      // The hold is already released; a failed notification must not undo that.
      this.logger.error(
        `Could not notify about expired hotel hold ${expired.bookingReference}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
    return true;
  }

  private async releaseHeldUnits(
    booking: HotelBookingDocument,
    session: ClientSession,
  ): Promise<void> {
    const nights = stayNights(booking.checkInDate, booking.nights);
    for (const item of booking.rooms) {
      for (const night of nights) {
        const released = await this.availabilityModel.updateOne(
          { room: item.room, date: night, heldUnits: { $gte: item.quantity } },
          { $inc: { heldUnits: -item.quantity } },
          { session },
        );
        if (released.modifiedCount !== 1) {
          this.logger.warn(
            `Room ${item.room.toString()} had fewer than ${item.quantity} held unit(s) on ${night.toISOString().slice(0, 10)} while expiring ${booking.bookingReference}`,
          );
        }
      }
    }
  }

  private toResponse(
    booking: HotelBookingDocument,
    hotel: Lean<Hotel> & HotelPolicySource,
  ): HotelBookingResponse {
    // Built field by field on purpose: spreading a Mongoose subdocument leaks internals.
    return {
      id: booking._id.toString(),
      bookingReference: booking.bookingReference,
      status: booking.status,
      hotelId: booking.hotel.toString(),
      hotelName: hotel.name,
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      nights: booking.nights,
      holdExpiresAt: booking.holdExpiresAt ?? null,
      rooms: booking.rooms.map((item) => ({
        roomId: item.room.toString(),
        roomName: item.roomName,
        adults: item.adults ?? 0,
        childrenAges: [...(item.childrenAges ?? [])],
        guestCount: item.guestCount ?? 0,
        nights: item.nights,
        averagePricePerNight: item.averagePricePerNight,
        subtotal: item.subtotal,
      })),
      guestCount: booking.guestCount,
      primaryGuestName: booking.primaryGuestName,
      primaryGuestEmail: booking.primaryGuestEmail,
      primaryGuestPhone: booking.primaryGuestPhone ?? null,
      specialRequests: booking.specialRequests ?? null,
      totalPrice: booking.totalPrice,
      currency: booking.currency,
      policies: booking.policySnapshot as unknown as HotelPolicySnapshot,
      createdAt: (booking as HotelBookingDocument & { createdAt: Date })
        .createdAt,
    };
  }

  private generateReference(): string {
    let reference = '';
    for (let i = 0; i < REFERENCE_LENGTH; i++) {
      reference += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
    }
    return reference;
  }

  private isDuplicateReference(error: unknown): boolean {
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
