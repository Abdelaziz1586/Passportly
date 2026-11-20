import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { PaymentPurpose } from '../../common/enums';
import { PaymentDocument } from './schemas/payment.schema';

/**
 * What happened when a paid payment of a special purpose was settled. Runs inside
 * the webhook transaction; `afterCommit` runs once the transaction committed
 * (notifications, sending a refund).
 */
export type PaidPaymentOutcome =
  | { kind: 'applied'; afterCommit: () => Promise<void> }
  | { kind: 'refund'; afterCommit: () => Promise<void> };

export interface PaidPaymentHandler {
  /**
   * The payment is already marked SUCCEEDED in `session`. Apply what it paid for,
   * or return `refund` (writing nothing) when that is no longer possible: the
   * whole payment is then refunded through the refund engine.
   */
  settle(
    payment: PaymentDocument,
    paidAt: Date,
    session: ClientSession,
  ): Promise<PaidPaymentOutcome>;
}

/**
 * Lets a feature module say what a paid payment of its purpose does without the
 * payments module importing it (flights imports payments, not the other way).
 */
@Injectable()
export class PaymentPurposeRegistry {
  private readonly handlers = new Map<PaymentPurpose, PaidPaymentHandler>();

  register(purpose: PaymentPurpose, handler: PaidPaymentHandler): void {
    this.handlers.set(purpose, handler);
  }

  get(purpose: PaymentPurpose): PaidPaymentHandler | undefined {
    return this.handlers.get(purpose);
  }
}
