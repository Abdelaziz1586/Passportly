import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import Stripe from 'stripe';
import {
  BookingStatus,
  BookingType,
  PaymentStatus,
  Role,
} from '../../common/enums';
import { FlightBooking } from '../flights/schemas/flight-booking.schema';
import { HotelBooking } from '../hotels/schemas/hotel-booking.schema';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { toMinorUnits } from './payment-amounts';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { Refund, RefundDocument } from './schemas/refund.schema';

/** Payments that can still be paid, retried or cancelled at Stripe. */
export const OPEN_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.PENDING,
  PaymentStatus.PROCESSING,
  PaymentStatus.FAILED,
];
/** A booking may have at most one payment in any of these states. */
export const LIVE_PAYMENT_STATUSES: PaymentStatus[] = [
  ...OPEN_PAYMENT_STATUSES,
  PaymentStatus.SUCCEEDED,
];
const REUSABLE_INTENT_STATUSES: Stripe.PaymentIntent.Status[] = [
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
];

export interface PaymentIntentResponse {
  paymentId: string;
  clientSecret: string;
  stripePaymentIntentId: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  bookingType: BookingType;
  bookingId: string;
  holdExpiresAt: Date;
}

export interface PaymentResponse {
  id: string;
  bookingType: BookingType;
  bookingId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  stripePaymentIntentId: string | null;
  failureReason: string | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The booking fields payment needs, identical on flights and hotels. */
interface PayableBooking {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  bookingReference: string;
  status: BookingStatus;
  holdExpiresAt?: Date;
  policySnapshot?: Record<string, unknown>;
  policyAcceptedAt?: Date;
  totalPrice: number;
  currency: string;
}

type StoredPayment = Payment & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

/** What a PaymentIntent is built from (works for a document and a lean object). */
type IntentSource = Pick<
  Payment,
  | 'amount'
  | 'currency'
  | 'user'
  | 'bookingType'
  | 'flightBooking'
  | 'hotelBooking'
> & { _id: Types.ObjectId };

/** Flight bookings and hotel reservations share these fields, so one model type serves both. */
type PayableBookingModel = Model<
  PayableBooking & { payment?: Types.ObjectId | null }
>;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  readonly stripe: Stripe | null;

  constructor(
    @InjectModel(Payment.name) readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Refund.name) readonly refundModel: Model<RefundDocument>,
    @InjectModel(FlightBooking.name)
    readonly flightBookingModel: Model<FlightBooking>,
    @InjectModel(HotelBooking.name)
    readonly hotelBookingModel: Model<HotelBooking>,
    readonly configService: ConfigService,
  ) {
    const secretKey = this.configService.get<string>('stripe.secretKey', '');
    this.stripe = secretKey ? new Stripe(secretKey) : null;
  }

  /**
   * PAY-01: start paying a PENDING_PAYMENT booking. The amount is the booking
   * total stored on the server; the client only names the booking. Card details
   * go straight to Stripe (Elements), only the Stripe ids, amount, currency and
   * status are kept here. The booking is never confirmed here: only the
   * verified webhook does that.
   */
  async createPayment(
    userId: string,
    dto: CreatePaymentDto,
  ): Promise<PaymentIntentResponse> {
    const stripe = this.requireStripe();
    const now = new Date();
    const booking = await this.findOwnedBooking(
      userId,
      dto.bookingType,
      dto.bookingId,
    );
    this.assertPayable(booking, now);

    const link =
      dto.bookingType === BookingType.FLIGHT
        ? { flightBooking: booking._id }
        : { hotelBooking: booking._id };
    const existing = await this.paymentModel
      .findOne({ ...link, status: { $in: LIVE_PAYMENT_STATUSES } })
      .select('status')
      .lean();
    if (existing) {
      throw new ConflictException(
        existing.status === PaymentStatus.SUCCEEDED
          ? 'This booking is already paid'
          : `A payment (${existing._id.toString()}) already exists for this booking: use POST /payments/${existing._id.toString()}/retry`,
      );
    }

    let payment: PaymentDocument;
    try {
      payment = await this.paymentModel.create({
        user: new Types.ObjectId(userId),
        bookingType: dto.bookingType,
        ...link,
        amount: booking.totalPrice,
        currency: booking.currency,
        status: PaymentStatus.PENDING,
        policyAcceptedAt: booking.policyAcceptedAt,
        holdExpiresAt: booking.holdExpiresAt,
        metadata: { intentAttempts: 1 },
      });
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException(
          'A payment for this booking is already in progress',
        );
      }
      throw error;
    }

    let intent: Stripe.PaymentIntent;
    try {
      intent = await this.createIntent(stripe, payment, booking, 1);
    } catch (error) {
      await this.paymentModel.deleteOne({ _id: payment._id });
      throw this.toProviderException(error);
    }

    payment.stripePaymentIntentId = intent.id;
    await payment.save();

    // Link the payment to the booking, but only while the booking is still payable.
    const linked = await this.bookingModelFor(dto.bookingType).updateOne(
      { _id: booking._id, status: BookingStatus.PENDING_PAYMENT },
      { $set: { payment: payment._id } },
    );
    if (linked.matchedCount !== 1) {
      await this.cancelIntent(stripe, intent.id);
      await this.paymentModel.updateOne(
        { _id: payment._id },
        { $set: { status: PaymentStatus.CANCELLED } },
      );
      throw new ConflictException('The booking can no longer be paid');
    }

    return this.toIntentResponse(payment, intent, booking, dto.bookingType);
  }

  /**
   * PAY-01: after a failed or still pending attempt, hand back a usable client
   * secret so the user can try again until the hold expires (the hold is never
   * extended). The same PaymentIntent is reused when Stripe still allows it,
   * otherwise a new one is created.
   */
  async retryPayment(
    userId: string,
    paymentId: string,
  ): Promise<PaymentIntentResponse> {
    const stripe = this.requireStripe();
    const now = new Date();
    const payment = await this.findOwnedPayment(userId, paymentId);
    if (!OPEN_PAYMENT_STATUSES.includes(payment.status)) {
      throw new ConflictException(
        `A ${payment.status} payment cannot be retried`,
      );
    }
    if (payment.status === PaymentStatus.PROCESSING) {
      throw new ConflictException('This payment is still being processed');
    }
    const { bookingType, bookingId } = this.linkedBooking(payment);
    const booking = await this.findOwnedBooking(userId, bookingType, bookingId);
    this.assertPayable(booking, now);

    let intent: Stripe.PaymentIntent | null = null;
    const stored = payment.metadata?.intentAttempts;
    let attempts = typeof stored === 'number' ? stored : 1;
    try {
      if (payment.stripePaymentIntentId) {
        intent = await stripe.paymentIntents.retrieve(
          payment.stripePaymentIntentId,
        );
        if (intent.status === 'succeeded' || intent.status === 'processing') {
          throw new ConflictException(
            'This payment already went through; the booking is confirmed once Stripe reports it',
          );
        }
        if (!REUSABLE_INTENT_STATUSES.includes(intent.status)) intent = null;
      }
      if (!intent) {
        attempts += 1;
        intent = await this.createIntent(stripe, payment, booking, attempts);
      }
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw this.toProviderException(error);
    }

    const updated = await this.paymentModel.findOneAndUpdate(
      { _id: payment._id, status: { $in: OPEN_PAYMENT_STATUSES } },
      {
        $set: {
          status: PaymentStatus.PENDING,
          stripePaymentIntentId: intent.id,
          'metadata.intentAttempts': attempts,
        },
        $unset: { failureReason: 1 },
      },
      { returnDocument: 'after' },
    );
    if (!updated) {
      throw new ConflictException('The payment changed; reload and try again');
    }
    return this.toIntentResponse(updated, intent, booking, bookingType);
  }

  /** The owner or an admin reads a payment. Never returns card data or the client secret. */
  async getPayment(
    userId: string,
    role: Role,
    paymentId: string,
  ): Promise<PaymentResponse> {
    if (!isValidObjectId(paymentId)) {
      throw new NotFoundException('Payment not found');
    }
    const filter: { _id: Types.ObjectId; user?: Types.ObjectId } = {
      _id: new Types.ObjectId(paymentId),
    };
    if (role !== Role.ADMIN) {
      if (!isValidObjectId(userId))
        throw new NotFoundException('Payment not found');
      filter.user = new Types.ObjectId(userId);
    }
    const payment = await this.paymentModel.findOne(filter).lean();
    if (!payment) throw new NotFoundException('Payment not found');
    return this.toPaymentResponse(payment as unknown as StoredPayment);
  }

  /** Cancels an intent; false when Stripe says it can no longer be cancelled (paid or processing). */
  async cancelIntent(stripe: Stripe, intentId: string): Promise<boolean> {
    try {
      await stripe.paymentIntents.cancel(intentId);
      return true;
    } catch (error) {
      try {
        const intent = await stripe.paymentIntents.retrieve(intentId);
        if (intent.status === 'canceled') return true;
      } catch {
        // fall through: report as not cancelled
      }
      this.logger.warn(
        `Could not cancel PaymentIntent ${intentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private createIntent(
    stripe: Stripe,
    payment: IntentSource,
    booking: PayableBooking,
    attempt: number,
  ): Promise<Stripe.PaymentIntent> {
    const { bookingType, bookingId } = this.linkedBooking(payment);
    return stripe.paymentIntents.create(
      {
        amount: toMinorUnits(payment.amount, payment.currency),
        currency: payment.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        description: `Passportly ${bookingType} booking ${booking.bookingReference}`,
        metadata: {
          paymentId: payment._id.toString(),
          bookingType,
          bookingId,
          userId: payment.user.toString(),
        },
      },
      { idempotencyKey: `payment-${payment._id.toString()}-${attempt}` },
    );
  }

  /** The booking has to be payable: PENDING_PAYMENT, hold running, policies accepted. */
  private assertPayable(booking: PayableBooking, now: Date): void {
    if (booking.status !== BookingStatus.PENDING_PAYMENT) {
      throw new ConflictException(`A ${booking.status} booking cannot be paid`);
    }
    if (!booking.holdExpiresAt || booking.holdExpiresAt <= now) {
      throw new ConflictException(
        'The hold has expired; place a new hold to continue',
      );
    }
    if (!booking.policySnapshot) {
      throw new ConflictException('Complete the booking details before paying');
    }
    if (!booking.policyAcceptedAt) {
      throw new ConflictException(
        'Accept the booking policies before paying (POST /bookings/:type/:id/accept-policies)',
      );
    }
    if (!(booking.totalPrice > 0)) {
      throw new ConflictException('This booking has no amount to pay');
    }
  }

  private async findOwnedBooking(
    userId: string,
    type: BookingType,
    id: string,
  ): Promise<PayableBooking> {
    if (!isValidObjectId(id) || !isValidObjectId(userId)) {
      throw new NotFoundException('Booking not found');
    }
    const booking: PayableBooking | null = await this.bookingModelFor(type)
      .findOne({
        _id: new Types.ObjectId(id),
        user: new Types.ObjectId(userId),
      })
      .lean();
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  private async findOwnedPayment(
    userId: string,
    id: string,
  ): Promise<StoredPayment> {
    if (!isValidObjectId(id) || !isValidObjectId(userId)) {
      throw new NotFoundException('Payment not found');
    }
    const payment = await this.paymentModel
      .findOne({
        _id: new Types.ObjectId(id),
        user: new Types.ObjectId(userId),
      })
      .lean();
    if (!payment) throw new NotFoundException('Payment not found');
    return payment as unknown as StoredPayment;
  }

  private bookingModelFor(type: BookingType): PayableBookingModel {
    return (type === BookingType.FLIGHT
      ? this.flightBookingModel
      : this.hotelBookingModel) as unknown as PayableBookingModel;
  }

  private linkedBooking(
    payment: Pick<Payment, 'bookingType' | 'flightBooking' | 'hotelBooking'>,
  ): {
    bookingType: BookingType;
    bookingId: string;
  } {
    const id =
      payment.bookingType === BookingType.FLIGHT
        ? payment.flightBooking
        : payment.hotelBooking;
    if (!id) throw new NotFoundException('Booking not found');
    return { bookingType: payment.bookingType, bookingId: id.toString() };
  }

  private requireStripe(): Stripe {
    if (!this.stripe) {
      throw new ServiceUnavailableException(
        'Payments are not configured on this server',
      );
    }
    return this.stripe;
  }

  private toProviderException(error: unknown): Error {
    const type = (error as { type?: string } | null)?.type;
    if (type === 'StripeInvalidRequestError') {
      this.logger.warn(
        `Stripe rejected the request: ${error instanceof Error ? error.message : ''}`,
      );
      return new BadRequestException(
        'The payment provider rejected this payment (check the amount and currency)',
      );
    }
    this.logger.error(
      'Stripe request failed',
      error instanceof Error ? error.stack : String(error),
    );
    return new ServiceUnavailableException(
      'The payment provider is unavailable, try again shortly',
    );
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: number }).code === 11000
    );
  }

  private toIntentResponse(
    payment: PaymentDocument,
    intent: Stripe.PaymentIntent,
    booking: PayableBooking,
    bookingType: BookingType,
  ): PaymentIntentResponse {
    if (!intent.client_secret) {
      throw new ServiceUnavailableException(
        'The payment provider returned no client secret',
      );
    }
    return {
      paymentId: payment._id.toString(),
      clientSecret: intent.client_secret,
      stripePaymentIntentId: intent.id,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      bookingType,
      bookingId: booking._id.toString(),
      holdExpiresAt: booking.holdExpiresAt as Date,
    };
  }

  private toPaymentResponse(payment: StoredPayment): PaymentResponse {
    const { bookingType, bookingId } = this.linkedBooking(payment);
    return {
      id: payment._id.toString(),
      bookingType,
      bookingId,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      stripePaymentIntentId: payment.stripePaymentIntentId ?? null,
      failureReason: payment.failureReason ?? null,
      paidAt: payment.paidAt ?? null,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }
}
