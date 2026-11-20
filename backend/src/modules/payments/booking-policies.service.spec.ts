import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus, BookingType } from '../../common/enums';
import { BookingPoliciesService } from './booking-policies.service';

const userId = new Types.ObjectId();
const otherUserId = new Types.ObjectId();

interface Stored {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  bookingReference: string;
  status: BookingStatus;
  holdExpiresAt?: Date;
  policySnapshot?: Record<string, unknown>;
  policyAcceptedAt?: Date;
  policyAcceptedBy?: Types.ObjectId;
}

function makeBooking(overrides: Partial<Stored> = {}): Stored {
  return {
    _id: new Types.ObjectId(),
    user: userId,
    bookingReference: 'ABCD2345',
    status: BookingStatus.PENDING_PAYMENT,
    holdExpiresAt: new Date(Date.now() + 5 * 60_000),
    policySnapshot: { capturedAt: new Date(), legs: [] },
    ...overrides,
  };
}

/** A fake Mongoose model backed by an array; it honours the owner in the filter. */
function makeModel(rows: Stored[]) {
  return {
    findOne: jest.fn(
      (filter: { _id: Types.ObjectId; user: Types.ObjectId }) => ({
        lean: () =>
          Promise.resolve(
            rows.find(
              (row) =>
                row._id.equals(filter._id) && row.user.equals(filter.user),
            ) ?? null,
          ),
      }),
    ),
    findOneAndUpdate: jest.fn(
      (
        filter: {
          _id: Types.ObjectId;
          user: Types.ObjectId;
          status: BookingStatus;
          holdExpiresAt: { $gt: Date };
          policyAcceptedAt: null;
        },
        update: {
          $set: { policyAcceptedAt: Date; policyAcceptedBy: Types.ObjectId };
        },
      ) => {
        const row = rows.find(
          (r) =>
            r._id.equals(filter._id) &&
            r.user.equals(filter.user) &&
            r.status === filter.status &&
            !!r.holdExpiresAt &&
            r.holdExpiresAt > filter.holdExpiresAt.$gt &&
            !r.policyAcceptedAt &&
            !!r.policySnapshot,
        );
        if (!row) return Promise.resolve(null);
        Object.assign(row, update.$set);
        return Promise.resolve(row);
      },
    ),
  };
}

function build(flights: Stored[] = [], hotels: Stored[] = []) {
  const flightModel = makeModel(flights);
  const hotelModel = makeModel(hotels);
  const service = new BookingPoliciesService(
    flightModel as never,
    hotelModel as never,
  );
  return { service, flightModel, hotelModel };
}

describe('BookingPoliciesService.getPolicies', () => {
  it('returns the stored flight snapshot and the not-accepted state', async () => {
    const booking = makeBooking();
    const { service, flightModel, hotelModel } = build([booking]);

    const result = await service.getPolicies(
      userId.toString(),
      BookingType.FLIGHT,
      booking._id.toString(),
    );

    expect(result).toEqual({
      bookingType: BookingType.FLIGHT,
      bookingId: booking._id.toString(),
      bookingReference: 'ABCD2345',
      status: BookingStatus.PENDING_PAYMENT,
      holdExpiresAt: booking.holdExpiresAt,
      policies: booking.policySnapshot,
      accepted: false,
      policyAcceptedAt: null,
      policyAcceptedBy: null,
    });
    expect(flightModel.findOne).toHaveBeenCalledTimes(1);
    expect(hotelModel.findOne).not.toHaveBeenCalled();
  });

  it('reads hotel reservations from the hotel collection', async () => {
    const reservation = makeBooking({
      policySnapshot: { checkInTime: '15:00', checkOutTime: '11:00' },
    });
    const { service, flightModel, hotelModel } = build([], [reservation]);

    const result = await service.getPolicies(
      userId.toString(),
      BookingType.HOTEL,
      reservation._id.toString(),
    );

    expect(result.policies).toEqual({
      checkInTime: '15:00',
      checkOutTime: '11:00',
    });
    expect(hotelModel.findOne).toHaveBeenCalledTimes(1);
    expect(flightModel.findOne).not.toHaveBeenCalled();
  });

  it('shows the acceptance timestamp once accepted', async () => {
    const acceptedAt = new Date('2026-11-19T10:00:00.000Z');
    const booking = makeBooking({
      policyAcceptedAt: acceptedAt,
      policyAcceptedBy: userId,
    });
    const { service } = build([booking]);

    const result = await service.getPolicies(
      userId.toString(),
      BookingType.FLIGHT,
      booking._id.toString(),
    );

    expect(result.accepted).toBe(true);
    expect(result.policyAcceptedAt).toEqual(acceptedAt);
    expect(result.policyAcceptedBy).toBe(userId.toString());
  });

  it('reports a lapsed hold as EXPIRED', async () => {
    const booking = makeBooking({ holdExpiresAt: new Date(Date.now() - 1000) });
    const { service } = build([booking]);

    const result = await service.getPolicies(
      userId.toString(),
      BookingType.FLIGHT,
      booking._id.toString(),
    );

    expect(result.status).toBe(BookingStatus.EXPIRED);
  });

  it("treats someone else's booking exactly like a missing one", async () => {
    const booking = makeBooking();
    const { service } = build([booking]);

    await expect(
      service.getPolicies(
        otherUserId.toString(),
        BookingType.FLIGHT,
        booking._id.toString(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not find a flight booking through the hotel type', async () => {
    const booking = makeBooking();
    const { service } = build([booking], []);

    await expect(
      service.getPolicies(
        userId.toString(),
        BookingType.HOTEL,
        booking._id.toString(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 404 for a malformed id without querying', async () => {
    const { service, flightModel } = build();

    await expect(
      service.getPolicies(userId.toString(), BookingType.FLIGHT, 'not-an-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(flightModel.findOne).not.toHaveBeenCalled();
  });

  it('is a 409 while a flight booking has no passenger details (no snapshot)', async () => {
    const booking = makeBooking({ policySnapshot: undefined });
    const { service } = build([booking]);

    await expect(
      service.getPolicies(
        userId.toString(),
        BookingType.FLIGHT,
        booking._id.toString(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
