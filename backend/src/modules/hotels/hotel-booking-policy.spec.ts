import { Types } from 'mongoose';
import { buildHotelPolicySnapshot } from './hotel-booking-policy';

const capturedAt = new Date('2026-11-19T10:00:00.000Z');
const hotelId = new Types.ObjectId();

describe('buildHotelPolicySnapshot', () => {
  it('copies times, terms and the existing cancellation fields', () => {
    const snapshot = buildHotelPolicySnapshot(
      {
        _id: hotelId,
        name: 'Nile Hotel',
        policies: {
          checkInTime: '14:00',
          checkOutTime: '12:00',
          allowCancellation: true,
          freeCancellationDaysBeforeCheckIn: 2,
          cancellationFeePercentage: 50,
          noShowFeePercentage: 100,
          termsText: 'No parties',
        },
      },
      capturedAt,
    );

    expect(snapshot).toEqual({
      capturedAt,
      hotelId: hotelId.toString(),
      hotelName: 'Nile Hotel',
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationPolicy: {
        allowCancellation: true,
        tiers: [],
        freeCancellationDaysBeforeCheckIn: 2,
        cancellationFeePercentage: 50,
        noShowFeePercentage: 100,
        termsText: 'No parties',
      },
    });
  });

  it('keeps valid tiers, highest threshold first, and drops malformed ones', () => {
    const snapshot = buildHotelPolicySnapshot(
      {
        _id: hotelId,
        name: 'Nile Hotel',
        policies: {
          cancellationTiers: [
            { daysBeforeCheckIn: 1, refundPercentage: 25 },
            { daysBeforeCheckIn: 7, refundPercentage: 100 },
            { daysBeforeCheckIn: '3', refundPercentage: 50 },
            { daysBeforeCheckIn: 3 },
            { daysBeforeCheckIn: 3, refundPercentage: 50 },
          ],
        },
      },
      capturedAt,
    );

    expect(snapshot.cancellationPolicy.tiers).toEqual([
      { daysBeforeCheckIn: 7, refundPercentage: 100 },
      { daysBeforeCheckIn: 3, refundPercentage: 50 },
      { daysBeforeCheckIn: 1, refundPercentage: 25 },
    ]);
  });

  it('falls back to the default times and null terms when the hotel set none', () => {
    const snapshot = buildHotelPolicySnapshot(
      { _id: hotelId, name: 'Bare Hotel' },
      capturedAt,
    );

    expect(snapshot.checkInTime).toBe('15:00');
    expect(snapshot.checkOutTime).toBe('11:00');
    expect(snapshot.cancellationPolicy).toEqual({
      allowCancellation: true,
      tiers: [],
      freeCancellationDaysBeforeCheckIn: null,
      cancellationFeePercentage: null,
      noShowFeePercentage: null,
      termsText: null,
    });
  });

  it('returns plain objects that do not alias the hotel document', () => {
    const tiers = [{ daysBeforeCheckIn: 2, refundPercentage: 80 }];
    const snapshot = buildHotelPolicySnapshot(
      { _id: hotelId, name: 'H', policies: { cancellationTiers: tiers } },
      capturedAt,
    );

    tiers[0].refundPercentage = 0;
    expect(snapshot.cancellationPolicy.tiers[0].refundPercentage).toBe(80);
  });
});
