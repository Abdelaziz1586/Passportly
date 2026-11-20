import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CabinClass, PassengerType } from '../../common/enums';
import {
  PassengerDetailsDto,
  PassengerGender,
} from './dto/create-flight-booking.dto';
import { Airline } from './schemas/airline.schema';
import { CabinInventory } from './schemas/cabin-inventory.schema';

/** Lowest plausible birth year, a sanity bound only. */
const MIN_BIRTH_YEAR = 1900;
/** Age on the outbound departure date: Adult 12+, Child 2-11, Infant under 2. */
export const ADULT_MIN_AGE = 12;
export const CHILD_MIN_AGE = 2;

export interface PassengerCounts {
  adults: number;
  children: number;
  infants: number;
}

export interface NormalizedPassenger {
  firstName: string;
  lastName: string;
  type: PassengerType;
  dateOfBirth: Date;
  gender: PassengerGender;
  passportNumber: string;
  passportExpiry: Date;
  nationality: string;
  extraBaggageCount: number;
  /** Weight of each extra bag in kg, when the client supplied it (validation only, not stored). */
  extraBaggageWeightKg: number | null;
}

/** Plain, JSON-safe copy of the policies in force when the booking was created. */
export type LegPolicySnapshot = {
  flightId: string;
  airlineId: string;
  airlineName: string;
  cabinClass: CabinClass;
  baggagePolicy: {
    carryOnBagsIncluded: number;
    carryOnMaxWeightKg: number;
    carryOnMaxDimensions: string | null;
    checkedBagsIncluded: number;
    checkedBagMaxWeightKg: number;
    extraBagFee: number;
    overweightFeePerKg: number;
    currency: string;
    notes: string | null;
  };
  cancellationPolicy: {
    allowCancellation: boolean;
    /** FLT-09 refund tiers copied at booking time; refunds use these, never the live airline policy. */
    tiers: { daysBeforeDeparture: number; refundPercentage: number }[];
    freeCancellationHoursBeforeDeparture: number;
    cancellationFeePercentage: number;
    fixedCancellationFee: number;
    refundPercentageAfterCutoff: number;
    currency: string;
    termsText: string | null;
  };
};

export type FlightPolicySnapshot = {
  capturedAt: Date;
  legs: LegPolicySnapshot[];
};

export interface PolicyLegSource {
  flightId: string;
  airline: Airline & { _id: Types.ObjectId };
  cabin: CabinInventory;
}

export interface LegBaggageTerms {
  extraBagFee: number;
  currency: string;
}

export interface BaggageFees {
  /** Extra baggage fee per passenger (all legs), in cents, same order as the passengers. */
  perPassengerCents: number[];
  totalCents: number;
}

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function parseDateOnly(value: string, label: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new BadRequestException(`${label} must be formatted YYYY-MM-DD`);
  }
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestException(`${label} is not a real calendar date`);
  }
  return date;
}

/** Whole years between dateOfBirth and `on` (both UTC calendar dates). */
export function ageOn(dateOfBirth: Date, on: Date): number {
  let age = on.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    on.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (on.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      on.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age--;
  return age;
}

function passengerTypeForAge(age: number): PassengerType {
  if (age >= ADULT_MIN_AGE) return PassengerType.ADULT;
  if (age >= CHILD_MIN_AGE) return PassengerType.CHILD;
  return PassengerType.INFANT;
}

function countByType(passengers: PassengerDetailsDto[]): PassengerCounts {
  const counts: PassengerCounts = { adults: 0, children: 0, infants: 0 };
  for (const { type } of passengers) {
    if (type === PassengerType.ADULT) counts.adults++;
    else if (type === PassengerType.CHILD) counts.children++;
    else if (type === PassengerType.INFANT) counts.infants++;
  }
  return counts;
}

/**
 * Checks the submitted travellers against the hold and returns clean copies.
 * Error messages name the passenger by position only: passport numbers must
 * never reach logs or responses.
 */
export function normalizePassengers(
  inputs: PassengerDetailsDto[],
  held: PassengerCounts,
  outboundDeparture: Date,
  lastArrival: Date,
  now: Date,
): NormalizedPassenger[] {
  const submitted = countByType(inputs);
  if (
    submitted.adults !== held.adults ||
    submitted.children !== held.children ||
    submitted.infants !== held.infants
  ) {
    throw new BadRequestException(
      `Passengers must match the hold: ${held.adults} adult(s), ${held.children} child(ren) and ${held.infants} infant(s), but ${submitted.adults}, ${submitted.children} and ${submitted.infants} were provided`,
    );
  }

  const lastArrivalDay = startOfUtcDay(lastArrival);
  const outboundDepartureDay = startOfUtcDay(outboundDeparture);
  const seenPassports = new Set<string>();

  return inputs.map((input, index) => {
    const who = `Passenger ${index + 1}`;
    const dateOfBirth = parseDateOnly(input.dateOfBirth, `${who} dateOfBirth`);
    if (dateOfBirth.getTime() > now.getTime()) {
      throw new BadRequestException(
        `${who} dateOfBirth cannot be in the future`,
      );
    }
    if (dateOfBirth.getUTCFullYear() < MIN_BIRTH_YEAR) {
      throw new BadRequestException(`${who} dateOfBirth is not plausible`);
    }
    // The type must match the age on the outbound departure date.
    const age = ageOn(dateOfBirth, outboundDepartureDay);
    if (passengerTypeForAge(age) !== input.type) {
      throw new BadRequestException(
        `${who} is ${age} year(s) old on the outbound departure date and cannot travel as ${input.type} (Adult ${ADULT_MIN_AGE}+, Child ${CHILD_MIN_AGE}-${ADULT_MIN_AGE - 1}, Infant under ${CHILD_MIN_AGE})`,
      );
    }

    const passportExpiry = parseDateOnly(
      input.passportExpiry,
      `${who} passportExpiry`,
    );
    if (passportExpiry.getTime() < lastArrivalDay.getTime()) {
      throw new BadRequestException(
        `${who} passport expires before the last flight arrives`,
      );
    }

    const passportNumber = input.passportNumber.trim().toUpperCase();
    if (seenPassports.has(passportNumber)) {
      throw new BadRequestException(
        `${who} repeats a passport number already used in this booking`,
      );
    }
    seenPassports.add(passportNumber);

    const extraBaggageCount = input.extraBaggageCount ?? 0;
    if (!Number.isInteger(extraBaggageCount) || extraBaggageCount < 0) {
      throw new BadRequestException(
        `${who} extraBaggageCount must be a whole number of 0 or more`,
      );
    }
    const extraBaggageWeightKg = input.extraBaggageWeightKg ?? null;
    if (
      extraBaggageWeightKg !== null &&
      (!Number.isFinite(extraBaggageWeightKg) ||
        extraBaggageWeightKg <= 0 ||
        extraBaggageCount === 0)
    ) {
      throw new BadRequestException(
        `${who} extraBaggageWeightKg must be above 0 and needs extraBaggageCount above 0`,
      );
    }
    if (input.type === PassengerType.INFANT && extraBaggageCount > 0) {
      throw new BadRequestException(
        `${who} is an infant and cannot add extra baggage`,
      );
    }

    return {
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      type: input.type,
      dateOfBirth,
      gender: input.gender,
      passportNumber,
      passportExpiry,
      nationality: input.nationality.trim().toUpperCase(),
      extraBaggageCount,
      extraBaggageWeightKg,
    };
  });
}

/** Maximum weight of one checked bag on this leg: cabin override, else airline policy. */
export function maxBagWeightKg({ airline, cabin }: PolicyLegSource): number {
  return (
    cabin.checkedBagMaxWeightKgOverride ??
    airline.baggagePolicy.checkedBagMaxWeightKg
  );
}

/**
 * FLT-08: when an airline sets maxExtraBagsPerPassenger, no passenger may ask
 * for more extra bags than that on that airline's leg. Airlines that leave it
 * unset are not limited.
 */
export function assertExtraBagCounts(
  passengers: NormalizedPassenger[],
  sources: PolicyLegSource[],
): void {
  for (const { airline } of sources) {
    const max = airline.baggagePolicy.maxExtraBagsPerPassenger;
    if (typeof max !== 'number') continue;
    passengers.forEach((passenger, index) => {
      if (passenger.extraBaggageCount > max) {
        throw new BadRequestException(
          `Passenger ${index + 1} asks for ${passenger.extraBaggageCount} extra bags but ${airline.name} allows at most ${max} per passenger`,
        );
      }
    });
  }
}

/**
 * Every extra bag travels on every leg, so its weight must fit the strictest
 * leg's per-bag maximum.
 */
export function assertExtraBagWeights(
  passengers: NormalizedPassenger[],
  sources: PolicyLegSource[],
): void {
  const limit = Math.min(...sources.map(maxBagWeightKg));
  passengers.forEach((passenger, index) => {
    const weight = passenger.extraBaggageWeightKg;
    if (weight !== null && weight > limit) {
      throw new BadRequestException(
        `Passenger ${index + 1} extra bag weighs ${weight} kg but the cabin allows at most ${limit} kg per bag`,
      );
    }
  });
}

/**
 * extraBaggageCount counts bags beyond the free allowance, so the fee is
 * count x extraBagFee for every leg (round trips pay on both legs, each at its
 * own airline's rate). No currency conversion happens here: a priced leg whose
 * policy currency differs from the booking currency cannot be charged.
 */
export function calculateBaggageFees(
  passengers: NormalizedPassenger[],
  legs: LegBaggageTerms[],
  bookingCurrency: string,
): BaggageFees {
  const anyExtraBags = passengers.some((p) => p.extraBaggageCount > 0);
  if (anyExtraBags) {
    const mismatched = legs.find(
      (leg) => leg.extraBagFee > 0 && leg.currency !== bookingCurrency,
    );
    if (mismatched) {
      throw new ConflictException(
        `Extra baggage is priced in ${mismatched.currency} but this booking is in ${bookingCurrency}; extra bags cannot be added to this booking`,
      );
    }
  }

  const perBagAllLegsCents = legs.reduce(
    (sum, leg) => sum + toCents(leg.extraBagFee),
    0,
  );
  const perPassengerCents = passengers.map(
    (p) => p.extraBaggageCount * perBagAllLegsCents,
  );
  return {
    perPassengerCents,
    totalCents: perPassengerCents.reduce((sum, cents) => sum + cents, 0),
  };
}

/** Copies every policy value into plain objects (no Mongoose documents). */
export function buildPolicySnapshot(
  sources: PolicyLegSource[],
  capturedAt: Date,
): FlightPolicySnapshot {
  return {
    capturedAt,
    legs: sources.map(({ flightId, airline, cabin }) => {
      const baggage = airline.baggagePolicy;
      const cancellation = airline.cancellationPolicy;
      return {
        flightId,
        airlineId: airline._id.toString(),
        airlineName: airline.name,
        cabinClass: cabin.cabinClass,
        baggagePolicy: {
          carryOnBagsIncluded: baggage.carryOnBagsIncluded,
          carryOnMaxWeightKg: baggage.carryOnMaxWeightKg,
          carryOnMaxDimensions: baggage.carryOnMaxDimensions ?? null,
          checkedBagsIncluded:
            cabin.checkedBagsIncludedOverride ?? baggage.checkedBagsIncluded,
          checkedBagMaxWeightKg: maxBagWeightKg({ flightId, airline, cabin }),
          extraBagFee: baggage.extraBagFee,
          overweightFeePerKg: baggage.overweightFeePerKg,
          currency: baggage.currency,
          notes: baggage.notes ?? null,
        },
        cancellationPolicy: {
          allowCancellation: cancellation.allowCancellation,
          // Highest threshold first: the refund uses the first tier whose threshold the days left reach.
          tiers: (cancellation.tiers ?? [])
            .map((tier) => ({
              daysBeforeDeparture: tier.daysBeforeDeparture,
              refundPercentage: tier.refundPercentage,
            }))
            .sort((a, b) => b.daysBeforeDeparture - a.daysBeforeDeparture),
          freeCancellationHoursBeforeDeparture:
            cancellation.freeCancellationHoursBeforeDeparture,
          cancellationFeePercentage: cancellation.cancellationFeePercentage,
          fixedCancellationFee: cancellation.fixedCancellationFee,
          refundPercentageAfterCutoff: cancellation.refundPercentageAfterCutoff,
          currency: cancellation.currency,
          termsText: cancellation.termsText ?? null,
        },
      };
    }),
  };
}

/** Shows only the last 4 characters, e.g. "****4567". */
export function maskPassport(passportNumber: string | undefined): string {
  if (!passportNumber) return '';
  const visible = passportNumber.slice(-4);
  return (
    '*'.repeat(Math.max(passportNumber.length - visible.length, 0)) + visible
  );
}
