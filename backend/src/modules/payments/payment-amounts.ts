/** Stripe currencies without minor units (amount is already whole units). */
const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);
/** Stripe currencies with three decimals; Stripe wants the last digit to be 0. */
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

/**
 * Converts a major-unit amount (e.g. 123.45 USD) to Stripe's smallest unit
 * (12345). The amount always comes from the stored booking total, never from the client.
 */
export function toMinorUnits(amount: number, currency: string): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return Math.round(amount);
  if (THREE_DECIMAL.has(code)) return Math.round(amount * 100) * 10;
  return Math.round(amount * 100);
}
