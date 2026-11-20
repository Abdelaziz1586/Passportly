import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
  /** Major units: > 0 and at most the payment amount. */
  amount: number;
  /** Must be the payment's currency. */
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

/** A refund Stripe keeps rejecting (not an outage) is marked FAILED after this many tries. */
export const MAX_REFUND_ATTEMPTS = 5;
const UNSENT_AFTER_MS = 20_000;
const UNSENT_BATCH_SIZE = 50;
/** Payments that still hold money that can be refunded. */
const REFUNDABLE_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.SUCCEEDED,
  PaymentStatus.PARTIALLY_REFUNDED,
];
const TRANSIENT_STRIPE_ERRORS = new Set([
  'StripeConnectionError',
  'StripeAPIError',
  'StripeRateLimitError',
]);
/** Shown to the user instead of raw Stripe messages (they can contain object ids). */
const GENERIC_FAILURE = 'The payment provider could not complete the refund';

/**
 * PAY-03: refunds. A refund is first recorded (PENDING, inside the cancellation
 * transaction), then sent to Stripe through the Refunds API with an idempotency
 * key, so a crash or a retry can never refund twice. A job re-sends refunds that
 * never reached Stripe. Stripe's own events settle PENDING into Refunded or Failed.
 *
 * Callers: recordRefund(input, session) inside their cancellation transaction,
 * then dispatchRefund(id) only AFTER that transaction committed (before the
 * commit the record is not visible yet and the job would pick it up later).
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
   * can only be refunded once: asking again returns the existing refund (also
   * when two requests race and the unique index rejects the second one).
   */
  async recordRefund(
    input: RecordRefundInput,
    session?: ClientSession,
  ): Promise<RefundDocument> {
    if (!(input.amount > 0)) {
      throw new BadRequestException('A refund needs a positive amount');
    }
    const existing = await this.refundModel
      .findOne({ payment: input.payment })
      .session(session ?? null);
    if (existing) return existing;

    const payment = await this.paymentModel
      .findById(input.payment)
      .session(session ?? null)
      .lean();
    if (!payment || !REFUNDABLE_PAYMENT_STATUSES.includes(payment.status)) {
      throw new ConflictException(
        'This payment has no money that can be refunded',
      );
    }
    if (
      input.amount > payment.amount ||
      input.currency.toUpperCase() !== payment.currency.toUpperCase()
    ) {
      throw new BadRequestException(
        'A refund cannot exceed the payment or use another currency',
      );
    }

    try {
      const [created] = await this.refundModel.create(
        [
          {
            payment: input.payment,
            user: input.user,
            bookingType: input.bookingType,
            bookingId: input.bookingId,
            amount: input.amount,
            currency: input.currency.toUpperCase(),
            status: RefundStatus.PENDING,
            reason: input.reason,
            policyCalculationNotes: input.notes,
          },
        ],
        { session },
      );
      return created;
    } catch (error) {
      if (!session && this.isDuplicateKey(error)) {
        const winner = await this.refundModel.findOne({
          payment: input.payment,
        });
        if (winner) return winner;
      }
      throw error;
    }
  }

  /**
   * Sends a recorded refund to Stripe (Refunds API). Safe to call again: the
   * Stripe idempotency key is the refund id and the record is only updated once.
   * Never throws for a Stripe problem: it returns false and the job retries.
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
    if (!refund) return true; // already sent, settled, or not committed yet
    const payment = await this.paymentModel.findById(refund.payment).lean();
    if (
      !payment?.stripePaymentIntentId ||
      !REFUNDABLE_PAYMENT_STATUSES.includes(payment.status)
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
        ...this.finalUpdate(status, stripeRefund),
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

  /**
   * `charge.refunded`: the charge was refunded, so look at Stripe's own state of
   * the refund(s) of this payment that are still PENDING and follow it. A refund
   * Stripe still reports as pending stays PENDING.
   */
  async settleForPayment(paymentId: Types.ObjectId): Promise<boolean> {
    const stripe = this.paymentsService.stripe;
    if (!stripe) return false;
    const pending = await this.refundModel
      .findOne({
        payment: paymentId,
        status: RefundStatus.PENDING,
        stripeRefundId: { $ne: null },
      })
      .lean();
    if (!pending?.stripeRefundId) return false;
    try {
      return await this.syncFromStripe(
        await stripe.refunds.retrieve(pending.stripeRefundId),
      );
    } catch (error) {
      this.logger.warn(
        `Could not read Stripe refund ${pending.stripeRefundId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * `refund.updated` / `refund.failed`: follow Stripe's final word on one refund.
   * Matches by the Stripe refund id, or by our refund id in the Stripe metadata
   * (a call that succeeded at Stripe but whose answer was lost). A PENDING refund
   * settles; so does one that was given up as FAILED before its Stripe id was known.
   */
  async syncFromStripe(stripeRefund: Stripe.Refund): Promise<boolean> {
    const status = this.toRefundStatus(stripeRefund.status);
    if (status === RefundStatus.PENDING) return false;
    const metadataId = stripeRefund.metadata?.refundId;
    const match: Record<string, unknown>[] = [
      { stripeRefundId: stripeRefund.id },
    ];
    if (typeof metadataId === 'string' && isValidObjectId(metadataId)) {
      match.push({ _id: new Types.ObjectId(metadataId) });
    }
    const updated = await this.refundModel.findOneAndUpdate(
      {
        $or: match,
        $and: [
          {
            $or: [
              { status: RefundStatus.PENDING },
              { status: RefundStatus.FAILED, stripeRefundId: null },
            ],
          },
        ],
      },
      {
        ...this.finalUpdate(status, stripeRefund),
      },
      { returnDocument: 'after' },
    );
    if (updated) await this.notifyOutcome(updated);
    return !!updated;
  }

  /** The update that records Stripe's answer: its id, the status, and the matching fields. */
  private finalUpdate(status: RefundStatus, stripeRefund: Stripe.Refund) {
    const base = { stripeRefundId: stripeRefund.id, status };
    if (status === RefundStatus.FAILED) {
      // Stripe's failure_reason is a short code (e.g. expired_or_canceled_card).
      return {
        $set: {
          ...base,
          failureReason: stripeRefund.failure_reason ?? GENERIC_FAILURE,
        },
      };
    }
    return {
      $set: {
        ...base,
        ...(status === RefundStatus.SUCCEEDED
          ? { processedAt: new Date() }
          : {}),
      },
      $unset: { failureReason: 1 },
    };
  }

  private async failRefund(refundId: Types.ObjectId, reason: string) {
    const failed = await this.refundModel.findOneAndUpdate(
      { _id: refundId, status: RefundStatus.PENDING },
      { $set: { status: RefundStatus.FAILED, failureReason: reason } },
      { returnDocument: 'after' },
    );
    if (failed) await this.notifyOutcome(failed);
  }

  /**
   * A Stripe call failed. An outage (connection, rate limit, 5xx) is retried
   * without limit; a rejection that will not change counts towards giving up.
   * The raw Stripe message is only logged: it can contain object ids.
   */
  private async recordFailedAttempt(refundId: Types.ObjectId, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const type = (error as { type?: string } | null)?.type;
    if (type && TRANSIENT_STRIPE_ERRORS.has(type)) {
      this.logger.warn(
        `Stripe unavailable for refund ${refundId.toString()}: ${message}`,
      );
      return;
    }
    this.logger.warn(
      `Stripe rejected refund ${refundId.toString()}: ${message}`,
    );
    const refund = await this.refundModel.findOneAndUpdate(
      { _id: refundId, status: RefundStatus.PENDING, stripeRefundId: null },
      { $inc: { attempts: 1 }, $set: { failureReason: GENERIC_FAILURE } },
      { returnDocument: 'after' },
    );
    if (refund && refund.attempts >= MAX_REFUND_ATTEMPTS) {
      await this.failRefund(refundId, GENERIC_FAILURE);
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

  private isDuplicateKey(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: number }).code === 11000
    );
  }

  private async notifyOutcome(refund: RefundDocument): Promise<void> {
    const amount = `${refund.amount.toFixed(2)} ${refund.currency}`;
    const base =
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
        message: refund.reason ? `${base} Reason: ${refund.reason}.` : base,
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
