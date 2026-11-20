import { BadRequestException, ConflictException } from '@nestjs/common';
import { INFANT_FARE_RATE } from './flight-bookings.service';

export interface FareCounts {
  adults: number;
  children: number;
  infants: number;
}

export interface FareCabin {
  basePrice: number;
  childPrice?: number | null;
}

const toCents = (amount: number): number => Math.round(amount * 100);

/**
 * What one leg costs the whole party, in cents, with the same rules as the hold
 * (FLT-22): adults and children pay the cabin fare (a child price when the cabin
 * has one), infants 10% of it.
 */
export function legFareCents(cabin: FareCabin, counts: FareCounts): number {
  const adult = toCents(cabin.basePrice);
  const child = toCents(cabin.childPrice ?? cabin.basePrice);
  const infant = toCents(
    Math.round(cabin.basePrice * INFANT_FARE_RATE * 100) / 100,
  );
  return (
    counts.adults * adult + counts.children * child + counts.infants * infant
  );
}

export interface OldLegFareInput {
  /** The leg's stored fare when a change wrote it (major units). */
  fare?: number;
  /** The fare per adult stored on the leg when the booking was made. */
  unitPrice: number;
  /** The cabin's current child price, only used when the leg has no stored fare. */
  childPrice?: number | null;
}

/**
 * The fare of each existing leg in cents. A leg a change wrote has its exact
 * fare. Otherwise it is rebuilt from the stored adult price (exact when nobody
 * pays a child price) and checked against the booking's base fare: if the legs
 * cannot be told apart reliably the change is refused rather than guessed.
 */
export function existingLegFaresCents(
  legs: OldLegFareInput[],
  counts: FareCounts,
  baseFareTotal: number,
): number[] {
  if (legs.length === 1) return [toCents(baseFareTotal)];
  if (legs.every((leg) => typeof leg.fare === 'number')) {
    return legs.map((leg) => toCents(leg.fare as number));
  }
  const rebuilt = legs.map((leg) =>
    legFareCents(
      { basePrice: leg.unitPrice, childPrice: leg.childPrice },
      counts,
    ),
  );
  const total = rebuilt.reduce((sum, cents) => sum + cents, 0);
  if (total !== toCents(baseFareTotal)) {
    throw new ConflictException(
      'The fare of each flight of this round trip cannot be told apart (prices changed since booking), so this booking cannot be changed online',
    );
  }
  return rebuilt;
}

export interface BagTerms {
  extraBagFee: number;
  currency: string;
}

/** Extra baggage fee in cents: every extra bag travels on every leg, at that leg's airline rate. */
export function extraBaggageCents(
  extraBagCounts: number[],
  legs: BagTerms[],
  bookingCurrency: string,
): number {
  const anyBags = extraBagCounts.some((count) => count > 0);
  if (anyBags) {
    const mismatched = legs.find(
      (leg) => leg.extraBagFee > 0 && leg.currency !== bookingCurrency,
    );
    if (mismatched) {
      throw new ConflictException(
        `Extra baggage is priced in ${mismatched.currency} but this booking is in ${bookingCurrency}; the flight cannot be changed to this airline`,
      );
    }
  }
  const perBag = legs.reduce((sum, leg) => sum + toCents(leg.extraBagFee), 0);
  return extraBagCounts.reduce((sum, count) => sum + count * perBag, 0);
}

export interface ChangeQuote {
  baseFareCents: number;
  extraBaggageCents: number;
  taxesCents: number;
  newTotalCents: number;
  oldTotalCents: number;
  /** New minus old: positive = the traveller pays, negative = a refund. */
  differenceCents: number;
}

export function quoteTotals(params: {
  legFares: number[];
  extraBaggage: number;
  taxesAndFees: number;
  oldTotal: number;
}): ChangeQuote {
  const baseFareCents = params.legFares.reduce((sum, cents) => sum + cents, 0);
  const taxesCents = toCents(params.taxesAndFees);
  const newTotalCents = baseFareCents + params.extraBaggage + taxesCents;
  const oldTotalCents = toCents(params.oldTotal);
  if (newTotalCents <= 0) {
    throw new BadRequestException('The changed booking would cost nothing');
  }
  return {
    baseFareCents,
    extraBaggageCents: params.extraBaggage,
    taxesCents,
    newTotalCents,
    oldTotalCents,
    differenceCents: newTotalCents - oldTotalCents,
  };
}
