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
 * PAY-02: show the provider policies of a booking before payment (SCRUM-82).
 * Recording the acceptance with a timestamp is SCRUM-83.
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
}
