import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { BookingStatus, BookingType, Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { Payment } from '../payments/schemas/payment.schema';
import { Refund } from '../payments/schemas/refund.schema';
import {
  HOTEL_BOOKING_LIST_DEFAULT_LIMIT,
  HotelBookingSortField,
  ListHotelBookingsQueryDto,
} from './dto/list-hotel-bookings-query.dto';
import { HotelBookingsService } from './hotel-bookings.service';
import {
  effectiveHotelStatus,
  groupOfStatus,
  HotelBookingDetails,
  HotelBookingListItem,
  HotelBookingListResponse,
  HotelDetailsPayment,
  HotelDetailsRefund,
  statusCondition,
  statusesToList,
} from './hotel-booking-view';
import { HotelBooking } from './schemas/hotel-booking.schema';
import { Hotel } from './schemas/hotel.schema';

type Stored = HotelBooking & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

const SORT_PATHS: Record<HotelBookingSortField, string> = {
  createdAt: 'createdAt',
  checkInDate: 'checkInDate',
  totalPrice: 'totalPrice',
};
const LAPSED_BATCH = 100;

/**
 * HTL-20: a traveller's own reservations (grouped Upcoming / Past / Cancelled,
 * filterable and sortable, paginated) and the full details of one reservation.
 * The owner always comes from the JWT; statuses are reported as they really are
 * now (a lapsed hold is EXPIRED, a stay whose check-out date passed is COMPLETED).
 */
@Injectable()
export class HotelBookingViewService {
  private readonly logger = new Logger(HotelBookingViewService.name);

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookingModel: Model<HotelBooking>,
    @InjectModel(Hotel.name) private readonly hotelModel: Model<Hotel>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(Refund.name) private readonly refundModel: Model<Refund>,
    private readonly hotelBookingsService: HotelBookingsService,
  ) {}

  async listBookings(
    userId: string,
    query: ListHotelBookingsQueryDto,
  ): Promise<HotelBookingListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? HOTEL_BOOKING_LIST_DEFAULT_LIMIT;
    const direction = query.sortOrder === 'asc' ? 1 : -1;
    const sortBy = query.sortBy ?? 'createdAt';
    if (!Object.hasOwn(SORT_PATHS, sortBy)) {
      // Normally stopped by the DTO; never let a raw key reach the sort.
      throw new BadRequestException(`Unsupported sortBy: ${sortBy}`);
    }
    const owner = new Types.ObjectId(userId);
    const now = new Date();

    await this.expireLapsedHoldsFor(owner, now);

    const statuses = statusesToList(query.group, query.status);
    const meta = (total: number) => ({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
    if (statuses.length === 0) return { data: [], meta: meta(0) };

    // Built from the validated DTO only: the owner is the JWT user, the rest are enums.
    const filter = {
      user: owner,
      $or: statuses.map((status) => statusCondition(status, now)),
    };
    const [bookings, total] = await Promise.all([
      this.bookingModel
        .find(filter)
        // _id as a tiebreaker keeps page boundaries stable when values repeat.
        .sort({ [SORT_PATHS[sortBy]]: direction, _id: direction })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean() as unknown as Promise<Stored[]>,
      this.bookingModel.countDocuments(filter),
    ]);
    const hotels = await this.hotelNames(bookings.map((b) => b.hotel));
    return {
      data: bookings.map((booking) => this.toListItem(booking, hotels, now)),
      meta: meta(total),
    };
  }

  async getBooking(
    user: AuthenticatedUser,
    id: string,
  ): Promise<HotelBookingDetails> {
    if (!isValidObjectId(id) || !isValidObjectId(user.userId)) {
      throw new NotFoundException('Hotel booking not found');
    }
    const booking = (await this.bookingModel
      .findById(new Types.ObjectId(id))
      .lean()) as unknown as Stored | null;
    if (!booking) throw new NotFoundException('Hotel booking not found');

    const isOwner = booking.user.equals(user.userId);
    const isModerator =
      user.role === Role.HOTEL_MODERATOR &&
      user.assignedProviderType === 'hotel' &&
      !!user.assignedProviderId &&
      booking.hotel.toString() === user.assignedProviderId;
    const allowed =
      user.role === Role.ADMIN ||
      (user.role === Role.REGISTERED_USER && isOwner) ||
      isModerator;
    // Someone else's reservation looks exactly like one that does not exist.
    if (!allowed) throw new NotFoundException('Hotel booking not found');

    const now = new Date();
    const hotels = await this.hotelNames([booking.hotel]);
    // A hotel moderator sees who stays where and when, not the traveller's contact details or any money.
    const moderatorView = isModerator && !isOwner && user.role !== Role.ADMIN;
    const status = effectiveHotelStatus(booking, now);
    return {
      id: booking._id.toString(),
      bookingReference: booking.bookingReference,
      status,
      group: groupOfStatus(status),
      hotelId: booking.hotel.toString(),
      hotelName: hotels.get(booking.hotel.toString()) ?? null,
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
        averagePricePerNight: moderatorView ? null : item.averagePricePerNight,
        subtotal: moderatorView ? null : item.subtotal,
      })),
      guestCount: booking.guestCount,
      primaryGuestName: booking.primaryGuestName,
      primaryGuestEmail: moderatorView ? null : booking.primaryGuestEmail,
      primaryGuestPhone: moderatorView
        ? null
        : (booking.primaryGuestPhone ?? null),
      specialRequests: booking.specialRequests ?? null,
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
      refund: moderatorView ? null : await this.refundSummary(booking._id),
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
    };
  }

  /**
   * Hold expiry is a once-a-minute job, so a hold that just ran out could still
   * read PENDING_PAYMENT. Before listing, this user's lapsed holds are expired
   * through the same expireHold() the job uses (atomic, releases the rooms,
   * notifies once, a no-op if the job got there first).
   */
  private async expireLapsedHoldsFor(owner: Types.ObjectId, now: Date) {
    try {
      const lapsed = await this.bookingModel
        .find({
          user: owner,
          status: { $in: [BookingStatus.PENDING_PAYMENT, BookingStatus.HELD] },
          holdExpiresAt: { $lte: now },
        })
        .select('_id')
        .limit(LAPSED_BATCH)
        .lean();
      for (const { _id } of lapsed) {
        await this.hotelBookingsService.expireHold(_id, now);
      }
    } catch (error) {
      // Listing must not fail because of housekeeping: the status is still reported as EXPIRED.
      this.logger.error(
        'Could not expire lapsed holds while listing hotel bookings',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async hotelNames(
    ids: Types.ObjectId[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const hotels = (await this.hotelModel
      .find({ _id: { $in: ids } })
      .select('name')
      .lean()) as unknown as { _id: Types.ObjectId; name: string }[];
    return new Map(hotels.map((hotel) => [hotel._id.toString(), hotel.name]));
  }

  private toListItem(
    booking: Stored,
    hotels: Map<string, string>,
    now: Date,
  ): HotelBookingListItem {
    const status = effectiveHotelStatus(booking, now);
    return {
      id: booking._id.toString(),
      bookingReference: booking.bookingReference,
      status,
      group: groupOfStatus(status),
      hotelId: booking.hotel.toString(),
      hotelName: hotels.get(booking.hotel.toString()) ?? null,
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      nights: booking.nights,
      rooms: booking.rooms.map((item) => ({
        roomId: item.room.toString(),
        roomName: item.roomName,
        guestCount: item.guestCount ?? 0,
        subtotal: item.subtotal,
      })),
      guestCount: booking.guestCount,
      totalPrice: booking.totalPrice,
      currency: booking.currency,
      holdExpiresAt: booking.holdExpiresAt ?? null,
      createdAt: booking.createdAt,
    };
  }

  private async paymentSummary(
    paymentId: Types.ObjectId | null | undefined,
  ): Promise<HotelDetailsPayment | null> {
    if (!paymentId) return null;
    const payment = (await this.paymentModel
      .findById(paymentId)
      .lean()) as unknown as (Payment & { _id: Types.ObjectId }) | null;
    if (!payment) return null;
    return {
      id: payment._id.toString(),
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      paidAt: payment.paidAt ?? null,
    };
  }

  private async refundSummary(
    bookingId: Types.ObjectId,
  ): Promise<HotelDetailsRefund | null> {
    const refund = (await this.refundModel
      .findOne({ bookingType: BookingType.HOTEL, bookingId })
      .sort({ createdAt: -1 })
      .lean()) as unknown as (Refund & { _id: Types.ObjectId }) | null;
    if (!refund) return null;
    return {
      id: refund._id.toString(),
      status: refund.status,
      amount: refund.amount,
      currency: refund.currency,
      reason: refund.reason ?? null,
      policyCalculationNotes: refund.policyCalculationNotes ?? null,
      processedAt: refund.processedAt ?? null,
    };
  }
}
