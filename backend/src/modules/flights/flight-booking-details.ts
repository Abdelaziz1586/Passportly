import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CabinClass, PassengerType } from '../../common/enums';
import {
  MAX_EXTRA_BAGS_PER_PASSENGER,
  PassengerDetailsDto,
  PassengerGender,
} from './dto/create-flight-booking.dto';
import { Airline } from './schemas/airline.schema';
import { CabinInventory } from './schemas/cabin-inventory.schema';

/** Lowest plausible birth year, a sanity bound only (no age/type rules are defined). */
const MIN_BIRTH_YEAR = 1900;

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
    if (
      !Number.isInteger(extraBaggageCount) ||
      extraBaggageCount < 0 ||
      extraBaggageCount > MAX_EXTRA_BAGS_PER_PASSENGER
    ) {
      throw new BadRequestException(
        `${who} extraBaggageCount must be a whole number from 0 to ${MAX_EXTRA_BAGS_PER_PASSENGER}`,
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
    };
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

export interface PolicyLegSource {
  flightId: string;
  airline: Airline & { _id: Types.ObjectId };
  cabin: CabinInventory;
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
          checkedBagMaxWeightKg:
            cabin.checkedBagMaxWeightKgOverride ??
            baggage.checkedBagMaxWeightKg,
          extraBagFee: baggage.extraBagFee,
          overweightFeePerKg: baggage.overweightFeePerKg,
          currency: baggage.currency,
          notes: baggage.notes ?? null,
        },
        cancellationPolicy: {
          allowCancellation: cancellation.allowCancellation,
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
