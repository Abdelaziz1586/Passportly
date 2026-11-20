import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  existingLegFaresCents,
  extraBaggageCents,
  legFareCents,
  quoteTotals,
} from './flight-change-pricing';

describe('legFareCents', () => {
  it('prices adults, children and infants like the hold (infants 10%)', () => {
    expect(
      legFareCents({ basePrice: 300 }, { adults: 2, children: 0, infants: 0 }),
    ).toBe(60000);
    // 2 adults + 1 infant: 600 + 30
    expect(
      legFareCents({ basePrice: 300 }, { adults: 2, children: 0, infants: 1 }),
    ).toBe(63000);
    // a child price when the cabin has one, the adult fare otherwise
    expect(
      legFareCents(
        { basePrice: 300, childPrice: 200 },
        { adults: 1, children: 2, infants: 0 },
      ),
    ).toBe(70000);
    expect(
      legFareCents({ basePrice: 300 }, { adults: 1, children: 1, infants: 0 }),
    ).toBe(60000);
  });

  it('rounds the infant fare to cents like the hold does', () => {
    // 10% of 99.99 is 9.999 -> 10.00
    expect(
      legFareCents(
        { basePrice: 99.99 },
        { adults: 0, children: 0, infants: 1 },
      ),
    ).toBe(1000);
  });
});

describe('existingLegFaresCents', () => {
  const counts = { adults: 2, children: 0, infants: 0 };

  it('is the whole base fare for a one-way booking', () => {
    expect(existingLegFaresCents([{ unitPrice: 300 }], counts, 600)).toEqual([
      60000,
    ]);
  });

  it('uses the exact fare a change stored on each leg', () => {
    expect(
      existingLegFaresCents(
        [
          { unitPrice: 1, fare: 480 },
          { unitPrice: 1, fare: 320.5 },
        ],
        counts,
        800.5,
      ),
    ).toEqual([48000, 32050]);
  });

  it('rebuilds the legs of a round trip from their stored prices when that adds up', () => {
    expect(
      existingLegFaresCents(
        [{ unitPrice: 300 }, { unitPrice: 250 }],
        counts,
        1100,
      ),
    ).toEqual([60000, 50000]);
  });

  it('refuses rather than guesses when the legs cannot be told apart', () => {
    expect(() =>
      existingLegFaresCents(
        [{ unitPrice: 300 }, { unitPrice: 250 }],
        counts,
        1234,
      ),
    ).toThrow(ConflictException);
  });
});

describe('extraBaggageCents', () => {
  it('charges every bag on every leg at that leg airline rate', () => {
    expect(
      extraBaggageCents(
        [2, 0, 1],
        [
          { extraBagFee: 40, currency: 'USD' },
          { extraBagFee: 25.5, currency: 'USD' },
        ],
        'USD',
      ),
    ).toBe(3 * (4000 + 2550));
  });

  it('is zero without bags, whatever the currency', () => {
    expect(
      extraBaggageCents([0, 0], [{ extraBagFee: 40, currency: 'EUR' }], 'USD'),
    ).toBe(0);
  });

  it('refuses bags priced in another currency than the booking', () => {
    expect(() =>
      extraBaggageCents([1], [{ extraBagFee: 40, currency: 'EUR' }], 'USD'),
    ).toThrow(ConflictException);
  });
});

describe('quoteTotals', () => {
  it('computes the signed difference from the old total', () => {
    const higher = quoteTotals({
      legFares: [72000],
      extraBaggage: 0,
      taxesAndFees: 0,
      oldTotal: 600,
    });
    expect(higher).toMatchObject({
      newTotalCents: 72000,
      oldTotalCents: 60000,
      differenceCents: 12000,
    });
    expect(
      quoteTotals({
        legFares: [50000],
        extraBaggage: 4000,
        taxesAndFees: 10,
        oldTotal: 600,
      }).differenceCents,
    ).toBe(50000 + 4000 + 1000 - 60000);
    expect(
      quoteTotals({
        legFares: [60000],
        extraBaggage: 0,
        taxesAndFees: 0,
        oldTotal: 600,
      }).differenceCents,
    ).toBe(0);
  });

  it('refuses a booking that would cost nothing', () => {
    expect(() =>
      quoteTotals({
        legFares: [0],
        extraBaggage: 0,
        taxesAndFees: 0,
        oldTotal: 10,
      }),
    ).toThrow(BadRequestException);
  });
});
