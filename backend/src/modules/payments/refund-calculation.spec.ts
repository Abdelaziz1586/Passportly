import {
  calculateRefund,
  RefundTier,
  selectRefundTier,
  wholeDaysUntil,
} from './refund-calculation';

const tiers: RefundTier[] = [
  { days: 2, refundPercentage: 50 },
  { days: 14, refundPercentage: 100 },
  { days: 0, refundPercentage: 10 },
  { days: 7, refundPercentage: 80 },
];
const now = new Date('2026-12-01T12:00:00.000Z');
const inDays = (days: number, extraHours = 0) =>
  new Date(now.getTime() + days * 86_400_000 + extraHours * 3_600_000);

describe('wholeDaysUntil', () => {
  it.each([
    [0, 0],
    [0.5, 0],
    [1, 1],
    [1.99, 1],
    [30, 30],
  ])('%p days away -> %p', (days, expected) => {
    expect(
      wholeDaysUntil(new Date(now.getTime() + days * 86_400_000), now),
    ).toBe(expected);
  });

  it('is never negative', () => {
    expect(wholeDaysUntil(new Date(now.getTime() - 5 * 86_400_000), now)).toBe(
      0,
    );
  });
});

describe('selectRefundTier (highest threshold not above the days left)', () => {
  it.each([
    [30, 14, 100],
    [14, 14, 100],
    [13, 7, 80],
    [7, 7, 80],
    [6, 2, 50],
    [2, 2, 50],
    [1, 0, 10],
    [0, 0, 10],
  ])('%p days left -> tier %p (%p%%)', (daysLeft, threshold, percentage) => {
    expect(selectRefundTier(tiers, daysLeft)).toEqual({
      days: threshold,
      refundPercentage: percentage,
    });
  });

  it('is null when no tier applies (the refund is 0%)', () => {
    expect(
      selectRefundTier([{ days: 3, refundPercentage: 100 }], 1),
    ).toBeNull();
    expect(selectRefundTier([], 10)).toBeNull();
  });

  it('does not depend on the order of the tiers', () => {
    const reversed = [...tiers].reverse();
    expect(selectRefundTier(reversed, 9)).toEqual(selectRefundTier(tiers, 9));
  });

  it('does not modify the tiers', () => {
    const copy = JSON.stringify(tiers);
    selectRefundTier(tiers, 5);
    expect(JSON.stringify(tiers)).toBe(copy);
  });
});

describe('calculateRefund', () => {
  const base = {
    total: 340.5,
    currency: 'USD',
    tiers,
    now,
    subject: 'departure' as const,
  };

  it('refunds the tier percentage of the full total, rounded to cents', () => {
    const result = calculateRefund({ ...base, start: inDays(10, 5) });

    expect(result.daysRemaining).toBe(10);
    expect(result.tier).toEqual({ days: 7, refundPercentage: 80 });
    expect(result.percentage).toBe(80);
    expect(result.amount).toBe(272.4);
    expect(result.notes).toContain('tier of 7+ day(s) applies, 80%');
  });

  it('refunds everything in the top tier', () => {
    expect(calculateRefund({ ...base, start: inDays(20) }).amount).toBe(340.5);
  });

  it('rounds half cents sensibly', () => {
    expect(
      calculateRefund({ ...base, total: 100.05, start: inDays(3) }).amount,
    ).toBe(50.03);
  });

  it('refunds 0 when no tier applies and says so', () => {
    const result = calculateRefund({
      ...base,
      tiers: [{ days: 5, refundPercentage: 100 }],
      start: inDays(1),
      subject: 'check-in',
    });

    expect(result.tier).toBeNull();
    expect(result.percentage).toBe(0);
    expect(result.amount).toBe(0);
    expect(result.notes).toContain('no cancellation tier applies');
    expect(result.notes).toContain('check-in');
  });

  it('handles a 0% tier and a booking with no tiers at all', () => {
    expect(
      calculateRefund({
        ...base,
        tiers: [{ days: 0, refundPercentage: 0 }],
        start: inDays(1),
      }).amount,
    ).toBe(0);
    expect(
      calculateRefund({ ...base, tiers: [], start: inDays(9) }).amount,
    ).toBe(0);
  });
});
