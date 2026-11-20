import type Stripe from 'stripe';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { ClientSession, Types } from 'mongoose';
import {
  BookingType,
  NotificationType,
  PaymentStatus,
  RefundStatus,
} from '../../common/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { FlightBookingDocument } from './schemas/flight-booking.schema';
import { FlightDocument } from './schemas/flight.schema';

@Injectable()
export class FlightEventsService {
  private readonly logger = new Logger(FlightEventsService.name);
  private processing = false;

  constructor(
    private readonly notifications: NotificationsService,
    private readonly payments: PaymentsService,
  ) {}

  async notify(
    booking: FlightBookingDocument,
    flight: FlightDocument,
    type: NotificationType,
    session: ClientSession,
  ) {
    const title =
      type === NotificationType.FLIGHT_CANCELLED
        ? 'Flight cancelled'
        : 'Flight schedule changed';
    await this.notifications.createNotification(
      {
        recipient: booking.user,
        type,
        title,
        message: flight.flightNumber + ': ' + title,
        relatedEntityType: 'flight',
        relatedEntityId: flight._id,
      },
      session,
    );
  }

  async queueRefund(
    booking: FlightBookingDocument,
    session: ClientSession,
    paymentId?: Types.ObjectId,
  ) {
    const payment = await this.payments.paymentModel
      .findOne({
        _id: paymentId ?? booking.payment,
        flightBooking: booking._id,
        status: PaymentStatus.SUCCEEDED,
      })
      .session(session);
    if (!payment?.stripePaymentIntentId) {
      throw new ConflictException(
        'Confirmed booking is missing a verified Stripe payment',
      );
    }
    await this.payments.refundModel.updateOne(
      { providerCancellationKey: booking._id.toString() },
      {
        $setOnInsert: {
          payment: payment._id,
          user: booking.user,
          bookingType: BookingType.FLIGHT,
          bookingId: booking._id,
          amount: payment.amount,
          currency: payment.currency,
          reason: 'Flight cancelled by provider',
          status: RefundStatus.PENDING,
        },
      },
      { upsert: true, session },
    );
    return payment.amount;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processRefunds() {
    const stripe = this.payments.stripe;
    if (!stripe || this.processing) return;
    this.processing = true;
    try {
      const refunds = await this.payments.refundModel
        .find({
          providerCancellationKey: { $exists: true },
          status: RefundStatus.PENDING,
        })
        .sort({ updatedAt: 1 })
        .limit(20);
      for (const refund of refunds) {
        try {
          const payment = await this.payments.paymentModel.findById(
            refund.payment,
          );
          if (!payment?.stripePaymentIntentId)
            throw new Error('Missing payment intent');
          const key = 'flight-cancellation-' + refund._id.toString();
          let result: Stripe.Refund | undefined = refund.stripeRefundId
            ? await stripe.refunds.retrieve(refund.stripeRefundId)
            : undefined;
          if (!result) {
            for await (const prior of stripe.refunds.list({
              payment_intent: payment.stripePaymentIntentId,
            })) {
              if (prior.metadata?.passportlyRefundKey === key) {
                result = prior;
                break;
              }
            }
          }
          result ??= await stripe.refunds.create(
            {
              payment_intent: payment.stripePaymentIntentId,
              metadata: { passportlyRefundKey: key },
            },
            { idempotencyKey: key },
          );
          const status =
            result.status === 'succeeded'
              ? RefundStatus.SUCCEEDED
              : result.status === 'failed' || result.status === 'canceled'
                ? RefundStatus.FAILED
                : RefundStatus.PENDING;
          await this.payments.refundModel.db.transaction(async (session) => {
            const updated = await this.payments.refundModel.findOneAndUpdate(
              { _id: refund._id, status: RefundStatus.PENDING },
              {
                stripeRefundId: result.id,
                status,
                ...(status !== RefundStatus.PENDING && {
                  processedAt: new Date(),
                }),
              },
              { session },
            );
            if (!updated || status === RefundStatus.PENDING) return;
            if (status === RefundStatus.SUCCEEDED) {
              await this.payments.paymentModel.updateOne(
                { _id: payment._id },
                { status: PaymentStatus.REFUNDED },
                { session },
              );
            }
            await this.notifications.createNotification(
              {
                recipient: refund.user,
                type: NotificationType.REFUND_PROCESSED,
                title: 'Flight refund update',
                message:
                  status === RefundStatus.SUCCEEDED
                    ? 'Your flight refund succeeded.'
                    : 'Your flight refund failed.',
                relatedEntityType: 'flightBooking',
                relatedEntityId: refund.bookingId,
              },
              session,
            );
          });
        } catch {
          this.logger.warn(
            'Refund processing will retry for ' + refund._id.toString(),
          );
          await this.payments.refundModel.updateOne(
            { _id: refund._id, status: RefundStatus.PENDING },
            { updatedAt: new Date() },
          );
        }
      }
    } finally {
      this.processing = false;
    }
  }
}
