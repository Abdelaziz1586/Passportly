import { Types } from 'mongoose';
import { CabinClass } from '../../common/enums';
import { buildPolicySnapshot, PolicyLegSource } from './flight-booking-details';

function source(
  tiers?: { daysBeforeDeparture: number; refundPercentage: number }[],
): PolicyLegSource {
  const airlineId = new Types.ObjectId();
  return {
    flightId: new Types.ObjectId().toString(),
    airline: {
      _id: airlineId,
      name: 'Nile Air',
      baggagePolicy: {
        carryOnBagsIncluded: 1,
        carryOnMaxWeightKg: 7,
        checkedBagsIncluded: 1,
        checkedBagMaxWeightKg: 23,
        extraBagFee: 40,
        overweightFeePerKg: 15,
        currency: 'USD',
      },
      cancellationPolicy: {
        allowCancellation: true,
        tiers,
        freeCancellationHoursBeforeDeparture: 24,
        cancellationFeePercentage: 20,
        fixedCancellationFee: 0,
        refundPercentageAfterCutoff: 0,
        currency: 'USD',
      },
    },
    cabin: { cabinClass: CabinClass.ECONOMY },
  } as unknown as PolicyLegSource;
}

describe('buildPolicySnapshot refund tiers (FLT-09)', () => {
  const capturedAt = new Date('2026-11-19T10:00:00.000Z');

  it('copies the tiers highest threshold first', () => {
    const snapshot = buildPolicySnapshot(
      [
        source([
          { daysBeforeDeparture: 2, refundPercentage: 50 },
          { daysBeforeDeparture: 14, refundPercentage: 100 },
          { daysBeforeDeparture: 0, refundPercentage: 10 },
        ]),
      ],
      capturedAt,
    );

    expect(snapshot.legs[0].cancellationPolicy.tiers).toEqual([
      { daysBeforeDeparture: 14, refundPercentage: 100 },
      { daysBeforeDeparture: 2, refundPercentage: 50 },
      { daysBeforeDeparture: 0, refundPercentage: 10 },
    ]);
  });

  it('is an empty list when the airline defined no tiers', () => {
    const snapshot = buildPolicySnapshot([source(undefined)], capturedAt);

    expect(snapshot.legs[0].cancellationPolicy.tiers).toEqual([]);
  });

  it('does not alias the airline tiers', () => {
    const tiers = [{ daysBeforeDeparture: 3, refundPercentage: 70 }];
    const snapshot = buildPolicySnapshot([source(tiers)], capturedAt);

    tiers[0].refundPercentage = 0;
    expect(snapshot.legs[0].cancellationPolicy.tiers[0].refundPercentage).toBe(
      70,
    );
  });
});
