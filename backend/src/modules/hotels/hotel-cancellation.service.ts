import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  ClientSession,
  Connection,
  isValidObjectId,
  Model,
  Types,
} from 'mongoose';
import {
  BookingStatus,
  BookingType,
  NotificationType,
  PaymentStatus,
  RefundStatus,
} from '../../common/enums';
import { NotificationsService } from '../notifications/notifications.service';
import {
  calculateRefund,
  RefundCalculation,
  RefundTier,
} from '../payments/refund-calculation';
import { RefundsService } from '../payments/refunds.service';
import { Payment } from '../payments/schemas/payment.schema';
import { CancelHotelBookingDto } from './dto/cancel-hotel-booking.dto';
import { startOfUtcDay, stayNights } from './hotel-booking-dates';
import { effectiveHotelStatus } from './hotel-booking-view';
import { HotelBooking } from './schemas/hotel-booking.schema';
import { RoomAvailability } from './schemas/room-availability.schema';

type Stored = HotelBooking & { _id: Types.ObjectId };

export interface HotelCancellationPreview {
  bookingId: string;
  bookingReference: string;
  status: BookingStatus;
  checkInDate: Date;
  daysRemaining: number;
  totalPrice: number;
  currency: string;
  tierApplied: { daysBeforeCheckIn: number; refundPercentage: number } | null;
  refundPercentage: number;
  refundAmount: number;
  policyCalculationNotes: string;
}

export interface HotelCancellationResult {
  bookingId: string;
  bookingReference: string;
  status: BookingStatus;
  cancelledAt: Date;
  refundPercentage: number;
  refundAmount: number;
  currency: string;
  policyCalculationNotes: string;
  refund: {
    id: string;
    status: RefundStatus;
    amount: number;
    currency: string;
  } | null;
}

/**
 * HTL-21: a traveller cancels their own CONFIRMED reservation as a whole before
 * the check-in date. The refund comes from the hotel's tiers copied onto the
 * reservation when it was made (HTL-10, same selection rule as FLT-09), measured
 * in whole days to the check-in date, on the full total. Confirmed -> Cancelled
 * is the only transition (GEN-11); partial cancellation does not exist. The
 * reservation, the released rooms and the refund record change in one
 * transaction; the money is sent to Stripe (PAY-03) after the commit.
 */
@Injectable()
export class HotelCancellationService {
  private readonly logger = new Logger(HotelCancellationService.name);

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookingModel: Model<HotelBooking>,
    @InjectModel(RoomAvailability.name)
    private readonly availabilityModel: Model<RoomAvailability>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectConnection() private readonly connection: Connection,
    private readonly refundsService: RefundsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** What cancelling now would refund, without changing anything. */
  async preview(userId: string, id: string): Promise<HotelCancellationPreview> {
    const now = new Date();
    const booking = await this.loadCancellable(userId, id, now);
    const quote = this.quote(booking, now);
    return {
      bookingId: booking._id.toString(),
      bookingReference: booking.bookingReference,
      status: booking.status,
      checkInDate: booking.checkInDate,
      daysRemaining: quote.daysRemaining,
      totalPrice: booking.totalPrice,
      currency: booking.currency,
      tierApplied: quote.tier
        ? {
            daysBeforeCheckIn: quote.tier.days,
            refundPercentage: quote.tier.refundPercentage,
          }
        : null,
      refundPercentage: quote.percentage,
      refundAmount: quote.amount,
      policyCalculationNotes: quote.notes,
    };
  }

  async cancel(
    userId: string,
    id: string,
    dto: CancelHotelBookingDto,
  ): Promise<HotelCancellationResult> {
    const now = new Date();
    const booking = await this.loadCancellable(userId, id, now);
    const quote = this.quote(booking, now);
    // The traveller confirmed the refund they were shown: if time moved the tier meanwhile,
    // ask them to look again instead of cancelling for another amount.
    if (
      dto.expectedRefundAmount !== undefined &&
      Math.round(dto.expectedRefundAmount * 100) !==
        Math.round(quote.amount * 100)
    ) {
      throw new ConflictException(
        `The refund changed from ${dto.expectedRefundAmount.toFixed(2)} to ${quote.amount.toFixed(2)} ${booking.currency}: preview the cancellation again`,
      );
    }
    const owner = new Types.ObjectId(userId);

    const outcome = await this.connection.transaction(async (session) => {
      // The payment is read inside the transaction, so what is decided here is what gets recorded.
      const payment = booking.payment
        ? await this.paymentModel
            .findById(booking.payment)
            .session(session)
            .lean()
        : null;
      const refundable =
        quote.amount > 0 &&
        !!payment &&
        payment.status === PaymentStatus.SUCCEEDED;
      // Only an amount that really gets refunded is stored on the reservation and announced.
      const refundAmount = refundable ? quote.amount : 0;

      // One conditional update: only a CONFIRMED reservation before its check-in date can be cancelled.
      const cancelled = await this.bookingModel.findOneAndUpdate(
        {
          _id: booking._id,
          user: owner,
          status: BookingStatus.CONFIRMED,
          checkInDate: { $gt: now },
        },
        {
          $set: {
            status: BookingStatus.CANCELLED,
            cancelledAt: now,
            refundAmount,
            ...(dto.reason ? { cancellationReason: dto.reason } : {}),
          },
        },
        { returnDocument: 'after', session },
      );
      if (!cancelled) {
        throw new ConflictException(
          'This reservation can no longer be cancelled (already cancelled, or the stay has started)',
        );
      }
      await this.releaseBookedUnits(booking, session);

      const refund =
        refundable && payment
          ? await this.refundsService.recordRefund(
              {
                payment: (payment as { _id: Types.ObjectId })._id,
                user: owner,
                bookingType: BookingType.HOTEL,
                bookingId: booking._id,
                amount: quote.amount,
                currency: payment.currency,
                reason: 'Cancelled by the traveller',
                notes: quote.notes,
              },
              session,
            )
          : null;
      return { refund, refundAmount };
    });

    // After the commit: send the money to Stripe. A failure here is not the traveller's problem:
    // the refund stays PENDING and the refund job sends it again.
    let current = outcome.refund;
    if (outcome.refund) {
      try {
        await this.refundsService.dispatchRefund(outcome.refund._id);
        current =
          (await this.refundsService.findRefund(outcome.refund._id)) ??
          outcome.refund;
      } catch (error) {
        this.logger.error(
          `Could not send refund ${outcome.refund._id.toString()} to Stripe now`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    const notes =
      outcome.refundAmount === 0 && quote.amount > 0
        ? `${quote.notes}. No refund could be issued because the payment can no longer be refunded.`
        : quote.notes;
    await this.notifyCancelled(booking, outcome.refundAmount, quote.percentage);

    return {
      bookingId: booking._id.toString(),
      bookingReference: booking.bookingReference,
      status: BookingStatus.CANCELLED,
      cancelledAt: now,
      refundPercentage: outcome.refundAmount > 0 ? quote.percentage : 0,
      refundAmount: outcome.refundAmount,
      currency: booking.currency,
      policyCalculationNotes: notes,
      // The status right after sending it to Stripe (PENDING if Stripe has not settled it yet);
      // GET /refunds/:id and the reservation details always show the current one.
      refund: current
        ? {
            id: current._id.toString(),
            status: current.status,
            amount: current.amount,
            currency: current.currency,
          }
        : null,
    };
  }

  /** The booked units of every room and stay night go back, guarded so a counter never goes below 0. */
  private async releaseBookedUnits(
    booking: Stored,
    session: ClientSession,
  ): Promise<void> {
    // Same nights the hold and the payment webhook used: check-in at UTC midnight, up to the night before check-out.
    const nights = stayNights(
      startOfUtcDay(booking.checkInDate),
      booking.nights,
    );
    for (const item of booking.rooms) {
      const released = await this.availabilityModel.updateMany(
        {
          room: item.room,
          date: { $in: nights },
          bookedUnits: { $gte: item.quantity },
        },
        { $inc: { bookedUnits: -item.quantity } },
        { session },
      );
      if (released.modifiedCount !== nights.length) {
        this.logger.warn(
          `Room ${item.room.toString()} had fewer than ${item.quantity} booked unit(s) on ${nights.length - released.modifiedCount} night(s) while cancelling ${booking.bookingReference}`,
        );
      }
    }
  }

  /** The owner's effectively CONFIRMED reservation before its check-in date; anything else is 404 or 409. */
  private async loadCancellable(
    userId: string,
    id: string,
    now: Date,
  ): Promise<Stored> {
    if (!isValidObjectId(id) || !isValidObjectId(userId)) {
      throw new NotFoundException('Hotel booking not found');
    }
    const booking = (await this.bookingModel
      .findOne({
        _id: new Types.ObjectId(id),
        user: new Types.ObjectId(userId),
      })
      .lean()) as unknown as Stored | null;
    if (!booking) throw new NotFoundException('Hotel booking not found');

    // The status as it really is now: nothing stores COMPLETED for a finished stay.
    const status = effectiveHotelStatus(booking, now);
    if (status !== BookingStatus.CONFIRMED) {
      throw new ConflictException(
        status === BookingStatus.PENDING_PAYMENT
          ? 'Only a CONFIRMED reservation can be cancelled; an unpaid hold expires by itself'
          : `A ${status} reservation cannot be cancelled`,
      );
    }
    if (booking.checkInDate.getTime() <= now.getTime()) {
      throw new ConflictException(
        'A reservation can only be cancelled before its check-in date',
      );
    }
    return booking;
  }

  /** Tiers of the hotel as stored on the reservation when it was made, on the full total. */
  private quote(booking: Stored, now: Date): RefundCalculation {
    const snapshot = booking.policySnapshot as
      | {
          cancellationPolicy?: {
            tiers?: { daysBeforeCheckIn: number; refundPercentage: number }[];
          };
        }
      | undefined;
    const tiers: RefundTier[] = (snapshot?.cancellationPolicy?.tiers ?? []).map(
      (tier) => ({
        days: tier.daysBeforeCheckIn,
        refundPercentage: tier.refundPercentage,
      }),
    );
    return calculateRefund({
      total: booking.totalPrice,
      currency: booking.currency,
      tiers,
      start: booking.checkInDate,
      now,
      subject: 'check-in',
    });
  }

  private async notifyCancelled(
    booking: Stored,
    refundAmount: number,
    percentage: number,
  ): Promise<void> {
    const refundText =
      refundAmount > 0
        ? ` A refund of ${refundAmount.toFixed(2)} ${booking.currency} (${percentage}%) has been requested.`
        : ' No refund applies.';
    try {
      await this.notificationsService.createNotification({
        recipient: booking.user,
        type: NotificationType.BOOKING_CANCELLED,
        title: 'Hotel reservation cancelled',
        message: `Reservation ${booking.bookingReference} was cancelled.${refundText}`,
        relatedEntityType: 'HotelBooking',
        relatedEntityId: booking._id,
      });
    } catch (error) {
      // The cancellation already happened; a failed notification must not undo it.
      this.logger.error(
        `Could not notify about the cancellation of ${booking.bookingReference}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
