/** A cancellation tier in neutral terms: at least `days` full days before the start, `refundPercentage`% comes back. */
export interface RefundTier {
  days: number;
  refundPercentage: number;
}

export interface RefundCalculation {
  /** Whole days left until the start (departure or check-in); never negative. */
  daysRemaining: number;
  /** The tier that applied, or null when none did (refund 0%). */
  tier: RefundTier | null;
  percentage: number;
  /** Money back, in major units, rounded to cents. */
  amount: number;
  /** Plain-language explanation stored with the refund. */
  notes: string;
}

const DAY_MS = 86_400_000;

/** Whole days between now and the start: 36 hours left is 1 day. Never below 0. */
export function wholeDaysUntil(start: Date, now: Date): number {
  return Math.max(0, Math.floor((start.getTime() - now.getTime()) / DAY_MS));
}

/**
 * FLT-09 / HTL-10 rule: the refund uses the tier with the highest threshold
 * that does not exceed the days remaining; if no tier applies the refund is 0%.
 */
export function selectRefundTier(
  tiers: RefundTier[],
  daysRemaining: number,
): RefundTier | null {
  let best: RefundTier | null = null;
  for (const tier of tiers) {
    if (
      tier.days <= daysRemaining &&
      (best === null || tier.days > best.days)
    ) {
      best = tier;
    }
  }
  return best;
}

/**
 * Refund of a cancellation, computed from the tiers stored on the booking
 * (never from the provider's current policy) on the full booking total.
 */
export function calculateRefund(params: {
  total: number;
  currency: string;
  tiers: RefundTier[];
  start: Date;
  now: Date;
  subject: 'departure' | 'check-in';
}): RefundCalculation {
  const daysRemaining = wholeDaysUntil(params.start, params.now);
  const tier = selectRefundTier(params.tiers, daysRemaining);
  const percentage = tier ? tier.refundPercentage : 0;
  const amount = Math.round(params.total * 100 * (percentage / 100)) / 100;
  const notes = tier
    ? `${daysRemaining} day(s) before ${params.subject}: the tier of ${tier.days}+ day(s) applies, ${percentage}% of ${params.total.toFixed(2)} ${params.currency} = ${amount.toFixed(2)} ${params.currency}`
    : `${daysRemaining} day(s) before ${params.subject}: no cancellation tier applies, so the refund is 0%`;
  return { daysRemaining, tier, percentage, amount, notes };
}
