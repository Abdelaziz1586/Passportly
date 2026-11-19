import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BookingStatus, BookingType } from '../../common/enums';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  FlightBooking,
  FlightBookingDocument,
} from '../flights/schemas/flight-booking.schema';
import {
  HotelBooking,
  HotelBookingDocument,
} from '../hotels/schemas/hotel-booking.schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ModeratorAssignment,
  ModeratorAssignmentDocument,
} from '../users/schemas/moderator-assignment.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  AdminBookingItemDto,
  ListAdminBookingsQueryDto,
  PaginatedAdminBookingsResponseDto,
} from './dto/list-admin-bookings-query.dto';

type PopulatedUser = {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  email?: string;
};

type LeanFlightBooking = {
  _id: Types.ObjectId;
  bookingReference: string;
  user: PopulatedUser | Types.ObjectId;
  tripType: string;
  legs: unknown[];
  passengerCounts: Record<string, unknown>;
  totalPrice: number;
  currency: string;
  status: BookingStatus;
  holdExpiresAt?: Date;
  confirmedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  refundAmount?: number;
  createdAt?: Date;
  updatedAt?: Date;
};

type LeanHotelBooking = {
  _id: Types.ObjectId;
  bookingReference: string;
  user: PopulatedUser | Types.ObjectId;
  hotel:
    { _id: Types.ObjectId; name?: string; cityName?: string } | Types.ObjectId;
  checkInDate: Date;
  checkOutDate: Date;
  nights: number;
  guestCount: number;
  rooms: unknown[];
  totalPrice: number;
  currency: string;
  status: BookingStatus;
  holdExpiresAt?: Date;
  confirmedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  refundAmount?: number;
  createdAt?: Date;
  updatedAt?: Date;
};

function formatUserRef(
  user: PopulatedUser | Types.ObjectId,
): Record<string, unknown> | string {
  if (user instanceof Types.ObjectId) {
    return user.toHexString();
  }
  if (
    typeof user === 'object' &&
    user !== null &&
    'email' in user &&
    typeof user.email === 'string'
  ) {
    return {
      id: user._id.toHexString(),
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    };
  }
  return user._id.toHexString();
}

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) readonly userModel: Model<UserDocument>,
    @InjectModel(ModeratorAssignment.name)
    readonly moderatorAssignmentModel: Model<ModeratorAssignmentDocument>,
    @InjectModel(FlightBooking.name)
    readonly flightBookingModel: Model<FlightBookingDocument>,
    @InjectModel(HotelBooking.name)
    readonly hotelBookingModel: Model<HotelBookingDocument>,
    readonly auditLogsService: AuditLogsService,
    readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Lists platform-wide flight and hotel bookings with filtering by bookingType,
   * status, userId, createdAt date range, sorting, and pagination.
   */
  async listPlatformBookings(
    query: ListAdminBookingsQueryDto,
  ): Promise<PaginatedAdminBookingsResponseDto> {
    if (query.fromDate && query.toDate && query.fromDate > query.toDate) {
      throw new BadRequestException(
        'fromDate must be before or equal to toDate',
      );
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortDirection = query.sortOrder === 'asc' ? 1 : -1;

    const filter: Record<string, unknown> = {};
    if (query.status) {
      filter.status = query.status;
    }
    if (query.userId) {
      filter.user = new Types.ObjectId(query.userId);
    }
    if (query.fromDate || query.toDate) {
      const createdAtRange: Record<string, Date> = {};
      if (query.fromDate) createdAtRange.$gte = query.fromDate;
      if (query.toDate) createdAtRange.$lte = query.toDate;
      filter.createdAt = createdAtRange;
    }

    const sortSpec: Record<string, 1 | -1> = {
      [sortBy]: sortDirection,
      _id: sortDirection,
    };

    if (query.bookingType === BookingType.FLIGHT) {
      const [items, total] = await Promise.all([
        this.flightBookingModel
          .find(filter)
          .populate('user', 'firstName lastName email')
          .populate('legs.flight', 'flightNumber departureTime arrivalTime')
          .sort(sortSpec)
          .skip((page - 1) * limit)
          .limit(limit)
          .lean<LeanFlightBooking[]>(),
        this.flightBookingModel.countDocuments(filter),
      ]);

      return {
        data: items.map((doc) => this.mapFlightBooking(doc)),
        total,
        page,
        limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      };
    }

    if (query.bookingType === BookingType.HOTEL) {
      const [items, total] = await Promise.all([
        this.hotelBookingModel
          .find(filter)
          .populate('user', 'firstName lastName email')
          .populate('hotel', 'name cityName')
          .sort(sortSpec)
          .skip((page - 1) * limit)
          .limit(limit)
          .lean<LeanHotelBooking[]>(),
        this.hotelBookingModel.countDocuments(filter),
      ]);

      return {
        data: items.map((doc) => this.mapHotelBooking(doc)),
        total,
        page,
        limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      };
    }

    const windowSize = page * limit;
    const [flightItems, hotelItems, flightTotal, hotelTotal] =
      await Promise.all([
        this.flightBookingModel
          .find(filter)
          .populate('user', 'firstName lastName email')
          .populate('legs.flight', 'flightNumber departureTime arrivalTime')
          .sort(sortSpec)
          .limit(windowSize)
          .lean<LeanFlightBooking[]>(),
        this.hotelBookingModel
          .find(filter)
          .populate('user', 'firstName lastName email')
          .populate('hotel', 'name cityName')
          .sort(sortSpec)
          .limit(windowSize)
          .lean<LeanHotelBooking[]>(),
        this.flightBookingModel.countDocuments(filter),
        this.hotelBookingModel.countDocuments(filter),
      ]);

    const combined = [
      ...flightItems.map((doc) => this.mapFlightBooking(doc)),
      ...hotelItems.map((doc) => this.mapHotelBooking(doc)),
    ].sort((a, b) => this.compareBookings(a, b, sortBy, sortDirection));

    const total = flightTotal + hotelTotal;
    const start = (page - 1) * limit;

    return {
      data: combined.slice(start, start + limit),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  private mapFlightBooking(doc: LeanFlightBooking): AdminBookingItemDto {
    return {
      id: String(doc._id),
      bookingType: BookingType.FLIGHT,
      bookingReference: doc.bookingReference,
      user: formatUserRef(doc.user),
      status: doc.status,
      totalPrice: doc.totalPrice,
      currency: doc.currency,
      details: {
        tripType: doc.tripType,
        passengerCounts: doc.passengerCounts,
        legs: doc.legs,
        ...(doc.holdExpiresAt !== undefined
          ? { holdExpiresAt: doc.holdExpiresAt }
          : {}),
        ...(doc.cancellationReason !== undefined
          ? { cancellationReason: doc.cancellationReason }
          : {}),
        ...(doc.refundAmount !== undefined
          ? { refundAmount: doc.refundAmount }
          : {}),
      },
      ...(doc.confirmedAt !== undefined
        ? { confirmedAt: doc.confirmedAt }
        : {}),
      ...(doc.cancelledAt !== undefined
        ? { cancelledAt: doc.cancelledAt }
        : {}),
      ...(doc.createdAt !== undefined ? { createdAt: doc.createdAt } : {}),
      ...(doc.updatedAt !== undefined ? { updatedAt: doc.updatedAt } : {}),
    };
  }

  private mapHotelBooking(doc: LeanHotelBooking): AdminBookingItemDto {
    return {
      id: String(doc._id),
      bookingType: BookingType.HOTEL,
      bookingReference: doc.bookingReference,
      user: formatUserRef(doc.user),
      status: doc.status,
      totalPrice: doc.totalPrice,
      currency: doc.currency,
      details: {
        hotel: doc.hotel,
        checkInDate: doc.checkInDate,
        checkOutDate: doc.checkOutDate,
        nights: doc.nights,
        guestCount: doc.guestCount,
        rooms: doc.rooms,
        ...(doc.holdExpiresAt !== undefined
          ? { holdExpiresAt: doc.holdExpiresAt }
          : {}),
        ...(doc.cancellationReason !== undefined
          ? { cancellationReason: doc.cancellationReason }
          : {}),
        ...(doc.refundAmount !== undefined
          ? { refundAmount: doc.refundAmount }
          : {}),
      },
      ...(doc.confirmedAt !== undefined
        ? { confirmedAt: doc.confirmedAt }
        : {}),
      ...(doc.cancelledAt !== undefined
        ? { cancelledAt: doc.cancelledAt }
        : {}),
      ...(doc.createdAt !== undefined ? { createdAt: doc.createdAt } : {}),
      ...(doc.updatedAt !== undefined ? { updatedAt: doc.updatedAt } : {}),
    };
  }

  private compareBookings(
    a: AdminBookingItemDto,
    b: AdminBookingItemDto,
    sortBy: 'createdAt' | 'updatedAt' | 'totalPrice' | 'status',
    direction: 1 | -1,
  ): number {
    let cmp = 0;
    if (sortBy === 'totalPrice') {
      cmp = a.totalPrice - b.totalPrice;
    } else if (sortBy === 'status') {
      cmp = a.status.localeCompare(b.status);
    } else {
      const aTime =
        (sortBy === 'updatedAt' ? a.updatedAt : a.createdAt)?.getTime() ?? 0;
      const bTime =
        (sortBy === 'updatedAt' ? b.updatedAt : b.createdAt)?.getTime() ?? 0;
      cmp = aTime - bTime;
    }
    if (cmp !== 0) {
      return cmp * direction;
    }
    return a.id.localeCompare(b.id) * direction;
  }
}
