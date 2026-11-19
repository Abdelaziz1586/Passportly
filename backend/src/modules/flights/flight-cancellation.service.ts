import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, isValidObjectId, Model, Types } from 'mongoose';
import {
  BookingStatus,
  BookingType,
  NotificationType,
  PaymentStatus,
} from '../../common/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { Payment } from '../payments/schemas/payment.schema';
import {
  calculateRefund,
  RefundCalculation,
  RefundTier,
} from '../payments/refund-calculation';
import { RefundsService } from '../payments/refunds.service';
import { CancelFlightBookingDto } from './dto/cancel-flight-booking.dto';
import { CabinInventory } from './schemas/cabin-inventory.schema';
import { FlightBooking } from './schemas/flight-booking.schema';

type Stored = FlightBooking & { _id: Types.ObjectId };

export interface CancellationPreview {
  bookingId: string;
  bookingReference: string;
  status: BookingStatus;
  departureTime: Date;
  daysRemaining: number;
  totalPrice: number;
  currency: string;
  tierApplied: { daysBeforeDeparture: number; refundPercentage: number } | null;
  refundPercentage: number;
  refundAmount: number;
  policyCalculationNotes: string;
}

export interface CancellationResult {
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
    status: string;
    amount: number;
    currency: string;
  } | null;
}

/**
 * FLT-26: a traveller cancels their own CONFIRMED booking before the outbound
 * departure. The refund comes from the airline's tiers copied onto the booking
 * when it was made (FLT-09), measured from the outbound flight even for a round
 * trip (FLT-12), on the whole booking total. Confirmed -> Cancelled is the only
 * transition (GEN-11). The booking, its seats and the refund record change in
 * one transaction; the money is sent to Stripe (PAY-03) after the commit.
 */
@Injectable()
export class FlightCancellationService {
  private readonly logger = new Logger(FlightCancellationService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    @InjectModel(CabinInventory.name)
    private readonly cabinModel: Model<CabinInventory>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectConnection() private readonly connection: Connection,
    private readonly refundsService: RefundsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** What cancelling now would refund, without changing anything. */
  async preview(userId: string, id: string): Promise<CancellationPreview> {
    const now = new Date();
    const booking = await this.loadCancellable(userId, id, now);
    const quote = this.quote(booking, now);
    return {
      bookingId: booking._id.toString(),
      bookingReference: booking.bookingReference,
      status: booking.status,
      departureTime: booking.legs[0].departureTime,
      daysRemaining: quote.daysRemaining,
      totalPrice: booking.totalPrice,
      currency: booking.currency,
      tierApplied: quote.tier
        ? {
            daysBeforeDeparture: quote.tier.days,
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
    dto: CancelFlightBookingDto,
  ): Promise<CancellationResult> {
    const now = new Date();
    const booking = await this.loadCancellable(userId, id, now);
    const quote = this.quote(booking, now);
    const payment = booking.payment
      ? await this.paymentModel.findById(booking.payment).lean()
      : null;
    const refundable =
      quote.amount > 0 &&
      !!payment &&
      payment.status === PaymentStatus.SUCCEEDED;
    const owner = new Types.ObjectId(userId);
    const seats = booking.passengerCounts.totalSeatsRequired;

    const refund = await this.connection.transaction(async (session) => {
      // One conditional update: only a CONFIRMED booking that has not departed can be cancelled.
      const cancelled = await this.bookingModel.findOneAndUpdate(
        {
          _id: booking._id,
          user: owner,
          status: BookingStatus.CONFIRMED,
          'legs.0.departureTime': { $gt: now },
        },
        {
          $set: {
            status: BookingStatus.CANCELLED,
            cancelledAt: now,
            refundAmount: quote.amount,
            ...(dto.reason ? { cancellationReason: dto.reason } : {}),
          },
        },
        { returnDocument: 'after', session },
      );
      if (!cancelled) {
        throw new ConflictException(
          'This booking can no longer be cancelled (already cancelled, or the flight has departed)',
        );
      }
      // The booked seats go back to the cabin of every leg.
      for (const leg of booking.legs) {
        await this.cabinModel.updateOne(
          { _id: leg.cabin },
          { $inc: { availableSeats: seats } },
          { session },
        );
      }
      if (!refundable || !payment) return null;
      return this.refundsService.recordRefund(
        {
          payment: (payment as { _id: Types.ObjectId })._id,
          user: owner,
          bookingType: BookingType.FLIGHT,
          bookingId: booking._id,
          amount: quote.amount,
          currency: payment.currency,
          reason: 'Cancelled by the traveller',
          notes: quote.notes,
        },
        session,
      );
    });

    // After the commit: send the money to Stripe. A failure here is not the traveller's problem:
    // the refund stays PENDING and the refund job sends it again.
    let current = refund;
    if (refund) {
      try {
        await this.refundsService.dispatchRefund(refund._id);
        current = (await this.refundsService.findRefund(refund._id)) ?? refund;
      } catch (error) {
        this.logger.error(
          `Could not send refund ${refund._id.toString()} to Stripe now`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    await this.notifyCancelled(booking, quote);

    return {
      bookingId: booking._id.toString(),
      bookingReference: booking.bookingReference,
      status: BookingStatus.CANCELLED,
      cancelledAt: now,
      refundPercentage: quote.percentage,
      refundAmount: quote.amount,
      currency: booking.currency,
      policyCalculationNotes: quote.notes,
      // The status right after sending it to Stripe (PENDING if Stripe has not settled it yet);
      // GET /refunds/:id and the booking details always show the current one.
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

  /** The owner's CONFIRMED booking that has not departed; anything else is 404 or 409. */
  private async loadCancellable(
    userId: string,
    id: string,
    now: Date,
  ): Promise<Stored> {
    if (!isValidObjectId(id) || !isValidObjectId(userId)) {
      throw new NotFoundException('Flight booking not found');
    }
    const booking = (await this.bookingModel
      .findOne({
        _id: new Types.ObjectId(id),
        user: new Types.ObjectId(userId),
      })
      .lean()) as unknown as Stored | null;
    if (!booking) throw new NotFoundException('Flight booking not found');
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException(
        booking.status === BookingStatus.PENDING_PAYMENT ||
          booking.status === BookingStatus.HELD
          ? 'Only a CONFIRMED booking can be cancelled; an unpaid hold expires by itself'
          : `A ${booking.status} booking cannot be cancelled`,
      );
    }
    if (booking.legs[0].departureTime.getTime() <= now.getTime()) {
      throw new ConflictException(
        'Cancellation after departure is not possible',
      );
    }
    return booking;
  }

  /** Tiers of the OUTBOUND leg, as stored on the booking when it was made. */
  private quote(booking: Stored, now: Date): RefundCalculation {
    const snapshot = booking.policySnapshot as
      | {
          legs?: {
            cancellationPolicy?: {
              tiers?: {
                daysBeforeDeparture: number;
                refundPercentage: number;
              }[];
            };
          }[];
        }
      | undefined;
    const tiers: RefundTier[] = (
      snapshot?.legs?.[0]?.cancellationPolicy?.tiers ?? []
    ).map((tier) => ({
      days: tier.daysBeforeDeparture,
      refundPercentage: tier.refundPercentage,
    }));
    return calculateRefund({
      total: booking.totalPrice,
      currency: booking.currency,
      tiers,
      start: booking.legs[0].departureTime,
      now,
      subject: 'departure',
    });
  }

  private async notifyCancelled(
    booking: Stored,
    quote: RefundCalculation,
  ): Promise<void> {
    const refundText =
      quote.amount > 0
        ? ` A refund of ${quote.amount.toFixed(2)} ${booking.currency} (${quote.percentage}%) is on its way.`
        : ' No refund applies under the airline policy.';
    try {
      await this.notificationsService.createNotification({
        recipient: booking.user,
        type: NotificationType.BOOKING_CANCELLED,
        title: 'Flight booking cancelled',
        message: `Booking ${booking.bookingReference} was cancelled.${refundText}`,
        relatedEntityType: 'FlightBooking',
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
