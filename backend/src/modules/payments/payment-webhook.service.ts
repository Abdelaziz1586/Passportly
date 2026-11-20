import {
  BadRequestException,
  Injectable,
  Optional,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import Stripe from 'stripe';
import {
  BookingStatus,
  BookingType,
  NotificationType,
  PaymentPurpose,
  PaymentStatus,
} from '../../common/enums';
import { CabinInventory } from '../flights/schemas/cabin-inventory.schema';
import { RoomAvailability } from '../hotels/schemas/room-availability.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { toMinorUnits } from './payment-amounts';
import {
  PaidPaymentOutcome,
  PaymentPurposeRegistry,
} from './payment-purpose-handlers';
import { OPEN_PAYMENT_STATUSES, PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';
import { PaymentDocument } from './schemas/payment.schema';

export type WebhookOutcome =
  | 'confirmed'
  | 'duplicate'
  | 'orphaned'
  | 'amount_mismatch'
  | 'unknown_payment'
  | 'failed'
  | 'cancelled'
  | 'processing'
  | 'refund_updated'
  | 'refunded'
  | 'ignored';

export interface WebhookResult {
  received: true;
  outcome: WebhookOutcome;
}

interface ConfirmedBooking {
  type: BookingType;
  id: Types.ObjectId;
  reference: string;
  user: Types.ObjectId;
}

const DAY_MS = 86_400_000;
const FAILURE_REASON_MAX = 300;

/**
 * PAY-01: the only place a booking becomes CONFIRMED. Stripe calls the
 * webhook; the signature is verified on the raw body before anything is read.
 * Every handler is idempotent: it changes state with a conditional update and
 * notifies only when this call really made the transition, so Stripe retries
 * and duplicate events change nothing.
 */
@Injectable()
export class PaymentWebhookService {
  private readonly logger = new Logger(PaymentWebhookService.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
    private readonly refundsService: RefundsService,
    @InjectModel(CabinInventory.name)
    private readonly cabinModel: Model<CabinInventory>,
    @InjectModel(RoomAvailability.name)
    private readonly roomAvailabilityModel: Model<RoomAvailability>,
    @InjectConnection() private readonly connection: Connection,
    // Last and optional so the service can be built without it; Nest always supplies it.
    @Optional() private readonly purposeRegistry?: PaymentPurposeRegistry,
  ) {}

  /** Verifies `stripe-signature` over the raw request body. Anything else is rejected with 400. */
  verifyEvent(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Stripe.Event {
    const stripe = this.paymentsService.stripe;
    const secret = this.configService.get<string>('stripe.webhookSecret', '');
    if (!stripe || !secret) {
      throw new ServiceUnavailableException(
        'Stripe webhooks are not configured on this server',
      );
    }
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    if (!rawBody) {
      throw new BadRequestException('Missing raw request body');
    }
    try {
      return stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new BadRequestException('Invalid Stripe signature');
    }
  }

  async handleEvent(event: Stripe.Event): Promise<WebhookResult> {
    let outcome: WebhookOutcome;
    switch (event.type) {
      case 'payment_intent.succeeded':
        outcome = await this.processSucceededIntent(
          event.data.object,
          // When Stripe says the payment completed, not when this request arrived.
          typeof event.created === 'number'
            ? new Date(event.created * 1000)
            : new Date(),
        );
        break;
      case 'payment_intent.processing':
        outcome = await this.onProcessing(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        outcome = await this.onFailed(event.data.object);
        break;
      case 'payment_intent.canceled':
        outcome = await this.onCanceled(event.data.object);
        break;
      case 'charge.refunded':
        outcome = await this.onChargeRefunded(event.data.object);
        break;
      case 'refund.updated':
      case 'refund.failed':
        outcome = (await this.refundsService.syncFromStripe(event.data.object))
          ? 'refund_updated'
          : 'ignored';
        break;
      default:
        outcome = 'ignored';
    }
    return { received: true, outcome };
  }

  /**
   * A PaymentIntent succeeded. `paidAt` is when the payment completed: only a
   * payment completed inside the booking hold confirms the booking, a later one
   * is refunded in full. Also used by the expiry job to reconcile an intent whose
   * webhook never arrived.
   */
  async processSucceededIntent(intent: Stripe.PaymentIntent, paidAt: Date) {
    const payment = await this.paymentsService.paymentModel
      .findOne({ stripePaymentIntentId: intent.id })
      .lean();
    if (!payment) {
      this.logger.warn(`PaymentIntent ${intent.id} has no payment record`);
      return 'unknown_payment' as const;
    }

    const expected = toMinorUnits(payment.amount, payment.currency);
    if (
      intent.amount_received !== expected ||
      intent.currency.toUpperCase() !== payment.currency.toUpperCase()
    ) {
      // Never confirm on an amount or currency the server did not ask for.
      this.logger.error(
        `PaymentIntent ${intent.id} paid ${intent.amount_received} ${intent.currency}, expected ${expected} ${payment.currency}`,
      );
      await this.paymentsService.paymentModel.updateOne(
        { _id: payment._id, status: { $in: OPEN_PAYMENT_STATUSES } },
        {
          $set: {
            status: PaymentStatus.FAILED,
            failureReason: 'Paid amount or currency does not match the booking',
            // Money was taken that the server did not ask for: flag it for a manual refund.
            'metadata.needsRefund': true,
          },
        },
      );
      return 'amount_mismatch' as const;
    }

    const result = await this.connection.transaction((session) =>
      this.confirmPayment(payment._id, paidAt, session),
    );
    if (result === 'duplicate') {
      // A retried event: finish a refund that an earlier attempt could not complete.
      if (payment.metadata?.needsRefund === true) {
        await this.ensureOrphanRefund(payment._id);
      }
      return 'duplicate' as const;
    }
    if (typeof result === 'object' && 'kind' in result) {
      // A payment of a special purpose (FLT-27): the handler already applied it, or asks for a refund.
      await result.afterCommit();
      if (result.kind === 'refund') {
        await this.ensureOrphanRefund(payment._id);
        return 'orphaned' as const;
      }
      return 'confirmed' as const;
    }
    if (result === 'orphaned') {
      this.logger.warn(
        `Payment ${payment._id.toString()} succeeded after its booking expired or was cancelled: refunding`,
      );
      await this.ensureOrphanRefund(payment._id);
      return 'orphaned' as const;
    }
    await this.notifyConfirmed(result, payment.amount, payment.currency);
    return 'confirmed' as const;
  }

  /**
   * One transaction: payment -> SUCCEEDED, booking PENDING_PAYMENT -> CONFIRMED
   * and the held inventory turns into booked inventory. The first conditional
   * update is the idempotency guard: a replayed event finds the payment already
   * SUCCEEDED and stops there.
   */
  private async confirmPayment(
    paymentId: Types.ObjectId,
    paidAt: Date,
    session: ClientSession,
  ): Promise<ConfirmedBooking | PaidPaymentOutcome | 'duplicate' | 'orphaned'> {
    const paid = await this.paymentsService.paymentModel.findOneAndUpdate(
      { _id: paymentId, status: { $in: OPEN_PAYMENT_STATUSES } },
      {
        $set: { status: PaymentStatus.SUCCEEDED, paidAt },
        $unset: { failureReason: 1 },
      },
      { returnDocument: 'after', session },
    );
    if (!paid) return 'duplicate';

    if (paid.purpose === PaymentPurpose.FLIGHT_CHANGE) {
      const handler = this.purposeRegistry?.get(paid.purpose);
      const outcome: PaidPaymentOutcome = handler
        ? await handler.settle(paid, paidAt, session)
        : { kind: 'refund', afterCommit: () => Promise.resolve() };
      if (outcome.kind === 'refund') {
        await this.paymentsService.paymentModel.updateOne(
          { _id: paymentId },
          { $set: { 'metadata.needsRefund': true } },
          { session },
        );
      }
      return outcome;
    }

    const confirmed =
      paid.bookingType === BookingType.FLIGHT
        ? await this.confirmFlight(paid, paidAt, session)
        : await this.confirmHotel(paid, paidAt, session);
    if (!confirmed) {
      await this.paymentsService.paymentModel.updateOne(
        { _id: paymentId },
        { $set: { 'metadata.needsRefund': true } },
        { session },
      );
      return 'orphaned';
    }
    return confirmed;
  }

  private async confirmFlight(
    payment: PaymentDocument,
    paidAt: Date,
    session: ClientSession,
  ): Promise<ConfirmedBooking | null> {
    const model = this.paymentsService.flightBookingModel;
    const booking = await model
      .findOne({
        _id: payment.flightBooking,
        status: BookingStatus.PENDING_PAYMENT,
        payment: payment._id,
        holdExpiresAt: { $gte: paidAt },
      })
      .session(session);
    if (!booking) return null;

    const set: Record<string, unknown> = {
      status: BookingStatus.CONFIRMED,
      confirmedAt: new Date(),
    };
    booking.passengers.forEach((_passenger, index) => {
      set[`passengers.${index}.eTicketNumber`] = this.eTicketNumber(
        booking.bookingReference,
        index,
      );
    });
    const updated = await model.findOneAndUpdate(
      { _id: booking._id, status: BookingStatus.PENDING_PAYMENT },
      { $set: set },
      { returnDocument: 'after', session },
    );
    if (!updated) return null;

    // Held seats become booked seats: availableSeats already went down at hold time.
    const seats = booking.passengerCounts.totalSeatsRequired;
    for (const leg of booking.legs) {
      const result = await this.cabinModel.updateOne(
        { _id: leg.cabin, heldSeats: { $gte: seats } },
        { $inc: { heldSeats: -seats } },
        { session },
      );
      if (result.modifiedCount !== 1) {
        this.logger.warn(
          `Cabin ${leg.cabin.toString()} had fewer than ${seats} held seats while confirming ${booking.bookingReference}`,
        );
      }
    }
    return {
      type: BookingType.FLIGHT,
      id: booking._id,
      reference: booking.bookingReference,
      user: booking.user,
    };
  }

  private async confirmHotel(
    payment: PaymentDocument,
    paidAt: Date,
    session: ClientSession,
  ): Promise<ConfirmedBooking | null> {
    const model = this.paymentsService.hotelBookingModel;
    const booking = await model
      .findOne({
        _id: payment.hotelBooking,
        status: BookingStatus.PENDING_PAYMENT,
        payment: payment._id,
        holdExpiresAt: { $gte: paidAt },
      })
      .session(session);
    if (!booking) return null;

    const updated = await model.findOneAndUpdate(
      { _id: booking._id, status: BookingStatus.PENDING_PAYMENT },
      { $set: { status: BookingStatus.CONFIRMED, confirmedAt: new Date() } },
      { returnDocument: 'after', session },
    );
    if (!updated) return null;

    // Held room units become booked units for every room and every stay night (UTC midnight).
    const checkIn = new Date(booking.checkInDate);
    const firstNight = Date.UTC(
      checkIn.getUTCFullYear(),
      checkIn.getUTCMonth(),
      checkIn.getUTCDate(),
    );
    for (const item of booking.rooms) {
      for (let night = 0; night < booking.nights; night++) {
        const result = await this.roomAvailabilityModel.updateOne(
          {
            room: item.room,
            date: new Date(firstNight + night * DAY_MS),
            heldUnits: { $gte: item.quantity },
          },
          { $inc: { heldUnits: -item.quantity, bookedUnits: item.quantity } },
          { session },
        );
        if (result.modifiedCount !== 1) {
          this.logger.warn(
            `Room ${item.room.toString()} had fewer than ${item.quantity} held units on night ${night + 1} while confirming ${booking.bookingReference}`,
          );
        }
      }
    }
    return {
      type: BookingType.HOTEL,
      id: booking._id,
      reference: booking.bookingReference,
      user: booking.user,
    };
  }

  /** Unique per booking and passenger: the booking reference is unique. */
  private eTicketNumber(reference: string, index: number): string {
    return `ETK${reference}${String(index + 1).padStart(2, '0')}`;
  }

  private async onFailed(intent: Stripe.PaymentIntent) {
    const reason = (
      intent.last_payment_error?.message ?? 'The payment failed'
    ).slice(0, FAILURE_REASON_MAX);
    // Only PENDING/PROCESSING -> FAILED notifies; a replayed event finds FAILED already.
    const payment = await this.paymentsService.paymentModel.findOneAndUpdate(
      {
        stripePaymentIntentId: intent.id,
        status: { $in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] },
      },
      { $set: { status: PaymentStatus.FAILED, failureReason: reason } },
      { returnDocument: 'after' },
    );
    if (!payment) return 'ignored' as const;
    await this.notify(
      payment.user,
      NotificationType.PAYMENT_FAILED,
      'Payment failed',
      `Your payment did not go through: ${reason}. You can try again until the booking hold expires.`,
      payment._id,
    );
    return 'failed' as const;
  }

  private async onProcessing(intent: Stripe.PaymentIntent) {
    const result = await this.paymentsService.paymentModel.updateOne(
      { stripePaymentIntentId: intent.id, status: PaymentStatus.PENDING },
      { $set: { status: PaymentStatus.PROCESSING } },
    );
    return result.modifiedCount === 1
      ? ('processing' as const)
      : ('ignored' as const);
  }

  private async onCanceled(intent: Stripe.PaymentIntent) {
    const payment = await this.paymentsService.paymentModel
      .findOne({ stripePaymentIntentId: intent.id })
      .select('holdExpiresAt')
      .lean();
    if (!payment) return 'ignored' as const;
    // An intent cancelled because its hold ended is EXPIRED, whichever of the
    // expiry job and this event gets there first.
    const holdEnded =
      !!payment.holdExpiresAt && payment.holdExpiresAt.getTime() <= Date.now();
    const result = await this.paymentsService.paymentModel.updateOne(
      {
        stripePaymentIntentId: intent.id,
        status: { $in: OPEN_PAYMENT_STATUSES },
      },
      {
        $set: {
          status: holdEnded ? PaymentStatus.EXPIRED : PaymentStatus.CANCELLED,
        },
      },
    );
    return result.modifiedCount === 1
      ? ('cancelled' as const)
      : ('ignored' as const);
  }

  /**
   * A payment that completed after its booking could no longer be confirmed is
   * refunded in full through the Stripe Refunds API (see RefundsService): one
   * Refund per payment, so a retried event never refunds twice. If Stripe is
   * unreachable the refund stays recorded as PENDING and the refund job re-sends it.
   */
  private async ensureOrphanRefund(paymentId: Types.ObjectId): Promise<void> {
    const payment = await this.paymentsService.paymentModel
      .findById(paymentId)
      .lean();
    if (!payment || payment.metadata?.needsRefund !== true) return;
    const bookingId =
      payment.bookingType === BookingType.FLIGHT
        ? (payment.flightBooking ?? payment.changedFlightBooking)
        : payment.hotelBooking;
    if (!bookingId) {
      this.logger.error(
        `Payment ${payment._id.toString()} has no booking to refund against`,
      );
      return;
    }
    const refund = await this.refundsService.recordRefund({
      payment: payment._id,
      user: payment.user,
      bookingType: payment.bookingType,
      bookingId,
      amount: payment.amount,
      currency: payment.currency,
      ...(payment.purpose === PaymentPurpose.FLIGHT_CHANGE
        ? {
            reason: 'The flight change could not be applied',
            notes:
              'Full refund of the fare difference: the change could not be applied (the booking changed, or the new flight had no seats left), so the booking stays as it was.',
          }
        : {
            reason: 'Payment received after the booking hold ended',
            notes:
              'Full refund: the payment completed after the booking expired or was cancelled, so the booking was not confirmed.',
          }),
    });
    await this.refundsService.dispatchRefund(refund._id);
  }

  private async onChargeRefunded(charge: Stripe.Charge) {
    const intentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;
    if (!intentId) return 'ignored' as const;
    const status =
      charge.amount_refunded >= charge.amount
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;
    const from =
      status === PaymentStatus.REFUNDED
        ? [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_REFUNDED]
        : [PaymentStatus.SUCCEEDED];
    const payment = await this.paymentsService.paymentModel
      .findOne({ stripePaymentIntentId: intentId })
      .select('_id')
      .lean();
    if (!payment) return 'ignored' as const;
    // The money is back: a sent PENDING Refund of this payment is settled too.
    const settled = await this.refundsService.settleForPayment(payment._id);
    const result = await this.paymentsService.paymentModel.updateOne(
      { _id: payment._id, status: { $in: from } },
      { $set: { status } },
    );
    return result.modifiedCount === 1 || settled
      ? ('refunded' as const)
      : ('ignored' as const);
  }

  private async notifyConfirmed(
    booking: ConfirmedBooking,
    amount: number,
    currency: string,
  ): Promise<void> {
    const label = booking.type === BookingType.FLIGHT ? 'flight' : 'hotel';
    const entityType =
      booking.type === BookingType.FLIGHT ? 'FlightBooking' : 'HotelBooking';
    await this.notify(
      booking.user,
      NotificationType.PAYMENT_SUCCEEDED,
      'Payment received',
      `We received your payment of ${amount.toFixed(2)} ${currency} for booking ${booking.reference}.`,
      booking.id,
      entityType,
    );
    await this.notify(
      booking.user,
      NotificationType.BOOKING_CONFIRMED,
      `Your ${label} booking is confirmed`,
      `Booking ${booking.reference} is confirmed.`,
      booking.id,
      entityType,
    );
  }

  /** A failed notification must never undo a payment that already went through. */
  private async notify(
    recipient: Types.ObjectId,
    type: NotificationType,
    title: string,
    message: string,
    relatedEntityId: Types.ObjectId,
    relatedEntityType = 'Payment',
  ): Promise<void> {
    try {
      await this.notificationsService.createNotification({
        recipient,
        type,
        title,
        message,
        relatedEntityType,
        relatedEntityId,
      });
    } catch (error) {
      this.logger.error(
        `Could not create ${type} notification`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
