import { toMinorUnits } from './payment-amounts';

describe('toMinorUnits', () => {
  it.each([
    [123.45, 'USD', 12345],
    [0.1 + 0.2, 'usd', 30],
    [19.999, 'EUR', 2000],
    [1, 'EGP', 100],
  ])('%p %s -> %p', (amount, currency, expected) => {
    expect(toMinorUnits(amount, currency)).toBe(expected);
  });

  it('keeps zero-decimal currencies whole', () => {
    expect(toMinorUnits(5000, 'JPY')).toBe(5000);
    expect(toMinorUnits(5000.4, 'krw')).toBe(5000);
  });

  it('uses three decimals ending in 0 for three-decimal currencies', () => {
    expect(toMinorUnits(1.234, 'KWD')).toBe(1230);
  });
});
