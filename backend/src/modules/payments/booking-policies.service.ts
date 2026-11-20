import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { BookingStatus, BookingType } from '../../common/enums';
import { FlightBooking } from '../flights/schemas/flight-booking.schema';
import { HotelBooking } from '../hotels/schemas/hotel-booking.schema';

export interface BookingPoliciesResponse {
  bookingType: BookingType;
  bookingId: string;
  bookingReference: string;
  status: BookingStatus;
  holdExpiresAt: Date | null;
  policies: Record<string, unknown>;
  accepted: boolean;
  policyAcceptedAt: Date | null;
  policyAcceptedBy: string | null;
}

export interface AcceptPoliciesResponse {
  bookingType: BookingType;
  bookingId: string;
  bookingReference: string;
  policyAcceptedAt: Date;
  policyAcceptedBy: string;
}

/** The fields PAY-02 needs, identical on flight bookings and hotel reservations. */
interface PolicyBookingView {
  _id: Types.ObjectId;
  bookingReference: string;
  status: BookingStatus;
  holdExpiresAt?: Date;
  policySnapshot?: Record<string, unknown>;
  policyAcceptedAt?: Date;
  policyAcceptedBy?: Types.ObjectId;
}

/**
 * PAY-02: show the provider policies of a booking before payment and record,
 * with a timestamp, that the owner accepted them.
 *
 * Ownership comes from the JWT user id only: a booking of someone else looks
 * exactly like a missing one (404).
 */
@Injectable()
export class BookingPoliciesService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly flightBookingModel: Model<FlightBooking>,
    @InjectModel(HotelBooking.name)
    private readonly hotelBookingModel: Model<HotelBooking>,
  ) {}

  async getPolicies(
    userId: string,
    type: BookingType,
    id: string,
  ): Promise<BookingPoliciesResponse> {
    const booking = await this.findOwned(userId, type, id);
    const policies = this.requirePolicies(booking);
    return {
      bookingType: type,
      bookingId: booking._id.toString(),
      bookingReference: booking.bookingReference,
      status: this.effectiveStatus(booking, new Date()),
      holdExpiresAt: booking.holdExpiresAt ?? null,
      policies,
      accepted: !!booking.policyAcceptedAt,
      policyAcceptedAt: booking.policyAcceptedAt ?? null,
      policyAcceptedBy: booking.policyAcceptedBy?.toString() ?? null,
    };
  }

  /**
   * Stores policyAcceptedAt and policyAcceptedBy. Only a PENDING_PAYMENT booking
   * whose hold is still running can accept. The first acceptance is kept: a
   * second call changes nothing and returns the stored timestamp.
   */
  async acceptPolicies(
    userId: string,
    type: BookingType,
    id: string,
  ): Promise<AcceptPoliciesResponse> {
    const now = new Date();
    const booking = await this.findOwned(userId, type, id);
    this.requirePolicies(booking);
    if (booking.policyAcceptedAt) return this.toAccepted(type, booking);

    if (booking.status !== BookingStatus.PENDING_PAYMENT) {
      throw new ConflictException(
        `Policies can only be accepted for a PENDING_PAYMENT booking (this one is ${booking.status})`,
      );
    }
    if (!booking.holdExpiresAt || booking.holdExpiresAt <= now) {
      throw new ConflictException(
        'The hold has expired; place a new hold to continue',
      );
    }

    const updated = await this.acceptOnce(type, booking._id, userId, now);
    if (updated) return this.toAccepted(type, updated);

    // Lost a race: another request accepted first, or the hold ran out meanwhile.
    const current = await this.findOwned(userId, type, id);
    if (current.policyAcceptedAt) return this.toAccepted(type, current);
    throw new ConflictException(
      'The booking can no longer accept policies (hold expired or booking changed)',
    );
  }

  private async findOwned(
    userId: string,
    type: BookingType,
    id: string,
  ): Promise<PolicyBookingView> {
    if (!isValidObjectId(id) || !isValidObjectId(userId)) {
      throw new NotFoundException('Booking not found');
    }
    const filter = {
      _id: new Types.ObjectId(id),
      user: new Types.ObjectId(userId),
    };
    const booking: PolicyBookingView | null =
      type === BookingType.FLIGHT
        ? await this.flightBookingModel.findOne(filter).lean()
        : await this.hotelBookingModel.findOne(filter).lean();
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /** A flight booking only has policies once passenger details were submitted (FLT-19). */
  private requirePolicies(booking: PolicyBookingView): Record<string, unknown> {
    if (!booking.policySnapshot) {
      throw new ConflictException(
        'This booking has no policies yet: complete the booking details first',
      );
    }
    return booking.policySnapshot;
  }

  private effectiveStatus(
    booking: PolicyBookingView,
    now: Date,
  ): BookingStatus {
    const holdLapsed =
      booking.status === BookingStatus.PENDING_PAYMENT &&
      !!booking.holdExpiresAt &&
      booking.holdExpiresAt <= now;
    return holdLapsed ? BookingStatus.EXPIRED : booking.status;
  }

  private acceptOnce(
    type: BookingType,
    bookingId: Types.ObjectId,
    userId: string,
    now: Date,
  ): Promise<PolicyBookingView | null> {
    const filter = {
      _id: bookingId,
      user: new Types.ObjectId(userId),
      status: BookingStatus.PENDING_PAYMENT,
      holdExpiresAt: { $gt: now },
      policySnapshot: { $ne: null },
      policyAcceptedAt: null,
    };
    const update = {
      $set: {
        policyAcceptedAt: now,
        policyAcceptedBy: new Types.ObjectId(userId),
      },
    };
    const options = { returnDocument: 'after' as const, lean: true };
    return type === BookingType.FLIGHT
      ? this.flightBookingModel.findOneAndUpdate(filter, update, options)
      : this.hotelBookingModel.findOneAndUpdate(filter, update, options);
  }

  private toAccepted(
    type: BookingType,
    booking: PolicyBookingView,
  ): AcceptPoliciesResponse {
    return {
      bookingType: type,
      bookingId: booking._id.toString(),
      bookingReference: booking.bookingReference,
      policyAcceptedAt: booking.policyAcceptedAt as Date,
      policyAcceptedBy: booking.policyAcceptedBy?.toString() ?? '',
    };
  }
}
