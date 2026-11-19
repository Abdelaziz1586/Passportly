import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientSession, isValidObjectId, Model, Types } from 'mongoose';
import Stripe from 'stripe';
import {
  BookingType,
  NotificationType,
  PaymentStatus,
  RefundStatus,
  Role,
} from '../../common/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { toMinorUnits } from './payment-amounts';
import { PaymentsService } from './payments.service';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { Refund, RefundDocument } from './schemas/refund.schema';

export interface RecordRefundInput {
  payment: Types.ObjectId;
  user: Types.ObjectId;
  bookingType: BookingType;
  bookingId: Types.ObjectId;
  /** Major units, > 0 and at most the payment amount. */
  amount: number;
  currency: string;
  reason: string;
  notes: string;
}

export interface RefundResponse {
  id: string;
  paymentId: string;
  bookingType: BookingType;
  bookingId: string;
  amount: number;
  currency: string;
  status: RefundStatus;
  reason: string | null;
  policyCalculationNotes: string | null;
  failureReason: string | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type StoredRefund = Refund & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

/** A refund that never reached Stripe is retried this many times before it is marked FAILED. */
export const MAX_REFUND_ATTEMPTS = 5;
const UNSENT_AFTER_MS = 20_000;
const UNSENT_BATCH_SIZE = 50;

/**
 * PAY-03: refunds. A refund is first recorded (PENDING, inside the cancellation
 * transaction), then sent to Stripe through the Refunds API with an idempotency
 * key, so a crash or a retry can never refund twice. A job re-sends refunds that
 * never reached Stripe. Stripe's own events settle PENDING into Refunded or Failed.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);
  private dispatching = false;

  constructor(
    @InjectModel(Refund.name)
    private readonly refundModel: Model<RefundDocument>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    private readonly paymentsService: PaymentsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Records a PENDING refund. Pass the session of the cancellation transaction so
   * the booking, its inventory and the refund record commit together. A payment
   * can only be refunded once: asking again returns the existing refund.
   */
  async recordRefund(
    input: RecordRefundInput,
    session?: ClientSession,
  ): Promise<RefundDocument> {
    const existing = await this.refundModel
      .findOne({ payment: input.payment })
      .session(session ?? null);
    if (existing) return existing;
    const [created] = await this.refundModel.create(
      [
        {
          payment: input.payment,
          user: input.user,
          bookingType: input.bookingType,
          bookingId: input.bookingId,
          amount: input.amount,
          currency: input.currency,
          status: RefundStatus.PENDING,
          reason: input.reason,
          policyCalculationNotes: input.notes,
        },
      ],
      { session },
    );
    return created;
  }

  /**
   * Sends a recorded refund to Stripe (Refunds API). Safe to call again: the
   * Stripe idempotency key is the refund id and the record is only updated once.
   * Returns false when it could not be sent (the job retries).
   */
  async dispatchRefund(refundId: Types.ObjectId): Promise<boolean> {
    const stripe = this.paymentsService.stripe;
    if (!stripe) return false;
    const refund = await this.refundModel
      .findOne({
        _id: refundId,
        status: RefundStatus.PENDING,
        stripeRefundId: null,
      })
      .lean();
    if (!refund) return true; // already sent or settled
    const payment = await this.paymentModel.findById(refund.payment).lean();
    if (
      !payment?.stripePaymentIntentId ||
      payment.status === PaymentStatus.PENDING
    ) {
      await this.failRefund(
        refund._id,
        'The payment has no completed Stripe charge to refund',
      );
      return true;
    }

    let stripeRefund: Stripe.Refund;
    try {
      stripeRefund = await stripe.refunds.create(
        {
          payment_intent: payment.stripePaymentIntentId,
          amount: toMinorUnits(refund.amount, refund.currency),
          metadata: {
            refundId: refund._id.toString(),
            bookingType: refund.bookingType,
            bookingId: refund.bookingId.toString(),
          },
        },
        { idempotencyKey: `refund-${refund._id.toString()}` },
      );
    } catch (error) {
      await this.recordFailedAttempt(refund._id, error);
      return false;
    }

    const status = this.toRefundStatus(stripeRefund.status);
    // The first writer wins: only that call notifies.
    const updated = await this.refundModel.findOneAndUpdate(
      { _id: refund._id, stripeRefundId: null },
      {
        $set: {
          stripeRefundId: stripeRefund.id,
          status,
          ...(status === RefundStatus.SUCCEEDED
            ? { processedAt: new Date() }
            : {}),
          ...(status === RefundStatus.FAILED
            ? {
                failureReason:
                  stripeRefund.failure_reason ??
                  'Stripe could not refund the payment',
              }
            : {}),
        },
        $inc: { attempts: 1 },
      },
      { returnDocument: 'after' },
    );
    if (updated) await this.notifyOutcome(updated);
    return true;
  }

  /** Re-sends refunds that never reached Stripe (crash, outage). */
  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'refund-dispatch' })
  async dispatchUnsentRefunds(): Promise<number> {
    if (!this.paymentsService.stripe || this.dispatching) return 0;
    this.dispatching = true;
    try {
      const unsent = await this.refundModel
        .find({
          status: RefundStatus.PENDING,
          stripeRefundId: null,
          createdAt: { $lte: new Date(Date.now() - UNSENT_AFTER_MS) },
        })
        .sort({ createdAt: 1 })
        .limit(UNSENT_BATCH_SIZE)
        .select('_id')
        .lean();
      let sent = 0;
      for (const { _id } of unsent) {
        try {
          if (await this.dispatchRefund(_id)) sent++;
        } catch (error) {
          this.logger.error(
            `Failed to dispatch refund ${_id.toString()}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
      return sent;
    } finally {
      this.dispatching = false;
    }
  }

  /** The owner or an admin reads a refund. */
  async getRefund(
    userId: string,
    role: Role,
    refundId: string,
  ): Promise<RefundResponse> {
    if (!isValidObjectId(refundId))
      throw new NotFoundException('Refund not found');
    const filter: { _id: Types.ObjectId; user?: Types.ObjectId } = {
      _id: new Types.ObjectId(refundId),
    };
    if (role !== Role.ADMIN) {
      if (!isValidObjectId(userId))
        throw new NotFoundException('Refund not found');
      filter.user = new Types.ObjectId(userId);
    }
    const refund = (await this.refundModel
      .findOne(filter)
      .lean()) as unknown as StoredRefund | null;
    if (!refund) throw new NotFoundException('Refund not found');
    return this.toResponse(refund);
  }

  /** `charge.refunded`: the money is back, so a PENDING refund of this payment is settled. */
  async settleForPayment(paymentId: Types.ObjectId): Promise<boolean> {
    const result = await this.refundModel.updateOne(
      {
        payment: paymentId,
        status: RefundStatus.PENDING,
        stripeRefundId: { $ne: null },
      },
      { $set: { status: RefundStatus.SUCCEEDED, processedAt: new Date() } },
    );
    return result.modifiedCount === 1;
  }

  /** `refund.updated` / `refund.failed`: follow Stripe's final word on one refund. */
  async syncFromStripe(stripeRefund: Stripe.Refund): Promise<boolean> {
    const status = this.toRefundStatus(stripeRefund.status);
    if (status === RefundStatus.PENDING) return false;
    const updated = await this.refundModel.findOneAndUpdate(
      { stripeRefundId: stripeRefund.id, status: RefundStatus.PENDING },
      {
        $set: {
          status,
          ...(status === RefundStatus.SUCCEEDED
            ? { processedAt: new Date() }
            : {}),
          ...(status === RefundStatus.FAILED
            ? {
                failureReason:
                  stripeRefund.failure_reason ??
                  'Stripe could not refund the payment',
              }
            : {}),
        },
      },
      { returnDocument: 'after' },
    );
    if (updated && status === RefundStatus.FAILED)
      await this.notifyOutcome(updated);
    return !!updated;
  }

  private async failRefund(refundId: Types.ObjectId, reason: string) {
    const failed = await this.refundModel.findOneAndUpdate(
      { _id: refundId, status: RefundStatus.PENDING },
      { $set: { status: RefundStatus.FAILED, failureReason: reason } },
      { returnDocument: 'after' },
    );
    if (failed) await this.notifyOutcome(failed);
  }

  private async recordFailedAttempt(refundId: Types.ObjectId, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `Stripe refund call failed for ${refundId.toString()}: ${message}`,
    );
    const refund = await this.refundModel.findOneAndUpdate(
      { _id: refundId, status: RefundStatus.PENDING, stripeRefundId: null },
      { $inc: { attempts: 1 }, $set: { failureReason: message.slice(0, 300) } },
      { returnDocument: 'after' },
    );
    if (refund && refund.attempts >= MAX_REFUND_ATTEMPTS) {
      await this.failRefund(
        refundId,
        `Gave up after ${refund.attempts} attempts: ${message.slice(0, 200)}`,
      );
    }
  }

  private toRefundStatus(
    stripeStatus: string | null | undefined,
  ): RefundStatus {
    if (stripeStatus === 'succeeded') return RefundStatus.SUCCEEDED;
    if (stripeStatus === 'failed' || stripeStatus === 'canceled')
      return RefundStatus.FAILED;
    return RefundStatus.PENDING;
  }

  private async notifyOutcome(refund: RefundDocument): Promise<void> {
    const amount = `${refund.amount.toFixed(2)} ${refund.currency}`;
    const message =
      refund.status === RefundStatus.SUCCEEDED
        ? `Your refund of ${amount} was issued.`
        : refund.status === RefundStatus.FAILED
          ? `Your refund of ${amount} could not be completed. Please contact support.`
          : `Your refund of ${amount} is being processed.`;
    try {
      await this.notificationsService.createNotification({
        recipient: refund.user,
        type: NotificationType.REFUND_PROCESSED,
        title:
          refund.status === RefundStatus.FAILED
            ? 'Refund failed'
            : 'Refund update',
        message,
        relatedEntityType: 'Refund',
        relatedEntityId: refund._id,
      });
    } catch (error) {
      this.logger.error(
        'Could not create the refund notification',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private toResponse(refund: StoredRefund): RefundResponse {
    return {
      id: refund._id.toString(),
      paymentId: refund.payment.toString(),
      bookingType: refund.bookingType,
      bookingId: refund.bookingId.toString(),
      amount: refund.amount,
      currency: refund.currency,
      status: refund.status,
      reason: refund.reason ?? null,
      policyCalculationNotes: refund.policyCalculationNotes ?? null,
      failureReason: refund.failureReason ?? null,
      processedAt: refund.processedAt ?? null,
      createdAt: refund.createdAt,
      updatedAt: refund.updatedAt,
    };
  }
}
