import { Types } from 'mongoose';

/** HTL-10 refund tier: the cancellation tier with the highest threshold not above the days left applies. */
export interface HotelCancellationTier {
  daysBeforeCheckIn: number;
  refundPercentage: number;
}

/** Plain-object copy of the hotel policies in force when the reservation was created (HTL-09, HTL-10). */
export type HotelPolicySnapshot = {
  capturedAt: Date;
  hotelId: string;
  hotelName: string;
  checkInTime: string;
  checkOutTime: string;
  cancellationPolicy: {
    allowCancellation: boolean;
    /** HTL-10 refund tiers, highest threshold first. Empty when the hotel defined none. */
    tiers: HotelCancellationTier[];
    /** Existing hotel policy fields, kept so a booking never loses terms the hotel did store. */
    freeCancellationDaysBeforeCheckIn: number | null;
    cancellationFeePercentage: number | null;
    noShowFeePercentage: number | null;
    termsText: string | null;
  };
};

/** The part of a (lean) hotel document the snapshot reads. */
export interface HotelPolicySource {
  _id: Types.ObjectId;
  name: string;
  policies?: {
    checkInTime?: string;
    checkOutTime?: string;
    allowCancellation?: boolean;
    freeCancellationDaysBeforeCheckIn?: number;
    cancellationFeePercentage?: number;
    noShowFeePercentage?: number;
    termsText?: string;
    /** HTL-10 tiers; read from the raw document so this works before the schema carries them. */
    cancellationTiers?: {
      daysBeforeCheckIn?: unknown;
      refundPercentage?: unknown;
    }[];
  };
}

const DEFAULT_CHECK_IN_TIME = '15:00';
const DEFAULT_CHECK_OUT_TIME = '11:00';

/** Copies every hotel policy value into plain objects (no Mongoose documents). */
export function buildHotelPolicySnapshot(
  hotel: HotelPolicySource,
  capturedAt: Date,
): HotelPolicySnapshot {
  const policies = hotel.policies ?? {};
  const tiers: HotelCancellationTier[] = [];
  for (const tier of policies.cancellationTiers ?? []) {
    if (
      typeof tier.daysBeforeCheckIn === 'number' &&
      typeof tier.refundPercentage === 'number'
    ) {
      tiers.push({
        daysBeforeCheckIn: tier.daysBeforeCheckIn,
        refundPercentage: tier.refundPercentage,
      });
    }
  }
  // Highest threshold first: the refund uses the first tier whose threshold the days left reach.
  tiers.sort((a, b) => b.daysBeforeCheckIn - a.daysBeforeCheckIn);
  return {
    capturedAt,
    hotelId: hotel._id.toString(),
    hotelName: hotel.name,
    checkInTime: policies.checkInTime ?? DEFAULT_CHECK_IN_TIME,
    checkOutTime: policies.checkOutTime ?? DEFAULT_CHECK_OUT_TIME,
    cancellationPolicy: {
      allowCancellation: policies.allowCancellation ?? true,
      tiers,
      freeCancellationDaysBeforeCheckIn:
        policies.freeCancellationDaysBeforeCheckIn ?? null,
      cancellationFeePercentage: policies.cancellationFeePercentage ?? null,
      noShowFeePercentage: policies.noShowFeePercentage ?? null,
      termsText: policies.termsText ?? null,
    },
  };
}
