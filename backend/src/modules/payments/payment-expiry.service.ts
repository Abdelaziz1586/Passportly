import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import Stripe from 'stripe';
import { PaymentStatus } from '../../common/enums';
import { PaymentWebhookService } from './payment-webhook.service';
import { OPEN_PAYMENT_STATUSES, PaymentsService } from './payments.service';
import { Payment } from './schemas/payment.schema';

const EXPIRY_BATCH_SIZE = 100;

type OpenPayment = Payment & { _id: import('mongoose').Types.ObjectId };

/**
 * PAY-01: when a booking hold ends, the PaymentIntent is cancelled at Stripe and
 * the payment becomes EXPIRED. Runs every 10 seconds so the gap between the hold
 * ending and the intent being cancelled stays small; a payment that still
 * completes in that gap is refunded by the webhook.
 *
 * Only payments whose own `holdExpiresAt` has passed are looked at, oldest check
 * first, so intents Stripe cannot cancel yet (processing) rotate instead of
 * blocking the batch.
 */
@Injectable()
export class PaymentExpiryService {
  private readonly logger = new Logger(PaymentExpiryService.name);
  private running = false;

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly paymentWebhookService: PaymentWebhookService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS, { name: 'payment-intent-expiry' })
  async expireLapsedPayments(): Promise<number> {
    const stripe = this.paymentsService.stripe;
    if (!stripe || this.running) return 0;
    this.running = true;
    try {
      const now = new Date();
      const lapsed = await this.paymentsService.paymentModel
        .find({
          status: { $in: OPEN_PAYMENT_STATUSES },
          holdExpiresAt: { $lte: now },
        })
        .sort({ 'metadata.expiryCheckedAt': 1 })
        .limit(EXPIRY_BATCH_SIZE)
        .lean();

      let handled = 0;
      for (const payment of lapsed) {
        try {
          if (await this.expire(stripe, payment, now)) handled++;
        } catch (error) {
          this.logger.error(
            `Failed to expire payment ${payment._id.toString()}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
      if (handled > 0) this.logger.log(`Expired ${handled} payment(s)`);
      return handled;
    } finally {
      this.running = false;
    }
  }

  private async expire(
    stripe: Stripe,
    payment: OpenPayment,
    now: Date,
  ): Promise<boolean> {
    const intentId = payment.stripePaymentIntentId;
    if (
      intentId &&
      !(await this.paymentsService.cancelIntent(stripe, intentId))
    ) {
      // Stripe would not cancel it: it was paid (the webhook never arrived) or is processing.
      const intent = await stripe.paymentIntents.retrieve(intentId);
      if (intent.status === 'succeeded') {
        const paidAt = await this.completedAt(stripe, intent);
        await this.paymentWebhookService.processSucceededIntent(intent, paidAt);
        return true;
      }
      await this.paymentsService.paymentModel.updateOne(
        { _id: payment._id },
        { $set: { 'metadata.expiryCheckedAt': now } },
      );
      return false;
    }
    const result = await this.paymentsService.paymentModel.updateOne(
      { _id: payment._id, status: { $in: OPEN_PAYMENT_STATUSES } },
      { $set: { status: PaymentStatus.EXPIRED } },
    );
    return result.modifiedCount === 1;
  }

  /** When the charge went through (falls back to the intent's creation time). */
  private async completedAt(
    stripe: Stripe,
    intent: Stripe.PaymentIntent,
  ): Promise<Date> {
    const chargeId =
      typeof intent.latest_charge === 'string'
        ? intent.latest_charge
        : intent.latest_charge?.id;
    if (chargeId) {
      try {
        const charge = await stripe.charges.retrieve(chargeId);
        return new Date(charge.created * 1000);
      } catch (error) {
        this.logger.warn(
          `Could not read charge ${chargeId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return new Date(intent.created * 1000);
  }
}
