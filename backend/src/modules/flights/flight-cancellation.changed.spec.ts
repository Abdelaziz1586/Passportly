import { Types } from 'mongoose';
import {
  BookingStatus,
  CabinClass,
  PaymentStatus,
  RefundStatus,
  TripType,
} from '../../common/enums';
import { FlightCancellationService } from './flight-cancellation.service';

interface Chain<T> extends PromiseLike<T> {
  lean(): Chain<T>;
  session(): Chain<T>;
}
function query<T>(result: T): Chain<T> {
  const q: Chain<T> = {
    lean: () => q,
    session: () => q,
    then: (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return q;
}

const DAY = 86_400_000;
const userId = new Types.ObjectId();
const original = new Types.ObjectId();
const extra = new Types.ObjectId();

function makeBooking(overrides: Record<string, unknown> = {}) {
  const departure = new Date(Date.now() + 20 * DAY);
  return {
    _id: new Types.ObjectId(),
    user: userId,
    bookingReference: 'ABCD2345',
    status: BookingStatus.CONFIRMED,
    tripType: TripType.ONE_WAY,
    legs: [
      {
        cabin: new Types.ObjectId(),
        cabinClass: CabinClass.ECONOMY,
        departureTime: departure,
        arrivalTime: new Date(departure.getTime() + 4 * 3_600_000),
      },
    ],
    passengerCounts: {
      adults: 2,
      children: 0,
      infants: 0,
      totalSeatsRequired: 2,
    },
    totalPrice: 720,
    currency: 'USD',
    payment: original,
    changeCount: 1,
    changePayments: [extra],
    policySnapshot: {
      legs: [
        {
          cancellationPolicy: {
            tiers: [{ daysBeforeDeparture: 14, refundPercentage: 100 }],
          },
        },
      ],
    },
    ...overrides,
  };
}

function build(
  booking: ReturnType<typeof makeBooking>,
  room: Record<string, number>,
) {
  const bookingModel = {
    findOne: jest.fn(() => query(booking)),
    findOneAndUpdate: jest.fn(() =>
      Promise.resolve({ ...booking, status: BookingStatus.CANCELLED }),
    ),
  };
  const cabinModel = {
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const paymentModel = {
    findById: jest.fn((id: Types.ObjectId) =>
      query({
        _id: id,
        status: PaymentStatus.SUCCEEDED,
        amount: id.equals(original) ? 600 : 120,
        currency: 'USD',
      }),
    ),
  };
  const connection = {
    transaction: jest.fn((cb: (s: unknown) => Promise<unknown>) =>
      cb({ id: 's' }),
    ),
  };
  const refundsService = {
    refundableCents: jest.fn((id: Types.ObjectId) =>
      Promise.resolve(room[id.toString()] ?? 0),
    ),
    recordBookingRefund: jest.fn(
      (input: { payments: Types.ObjectId[]; amount: number }) =>
        Promise.resolve(
          input.payments.map((p) => ({
            _id: new Types.ObjectId(),
            payment: p,
            amount: input.amount,
            currency: 'USD',
            status: RefundStatus.PENDING,
          })),
        ),
    ),
    recordRefund: jest.fn(),
    dispatchRefund: jest.fn().mockResolvedValue(true),
    findRefund: jest.fn().mockResolvedValue(null),
  };
  const notifications = { createNotification: jest.fn().mockResolvedValue({}) };
  const service = new FlightCancellationService(
    bookingModel as never,
    cabinModel as never,
    paymentModel as never,
    connection as never,
    refundsService as never,
    notifications as never,
  );
  return { service, refundsService, bookingModel };
}

describe('FlightCancellationService after a flight change', () => {
  it('refunds the policy share of the changed total across the payments, keyed on the booking', async () => {
    const booking = makeBooking();
    const t = build(booking, {
      [original.toString()]: 60000,
      [extra.toString()]: 12000,
    });
    const res = await t.service.cancel(
      userId.toString(),
      booking._id.toString(),
      { confirm: true },
    );
    expect(res).toMatchObject({
      status: BookingStatus.CANCELLED,
      refundPercentage: 100,
      refundAmount: 720,
    });
    expect(t.refundsService.recordRefund).not.toHaveBeenCalled();
    expect(t.refundsService.recordBookingRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        payments: [extra, original],
        amount: 720,
        key: `cancel-${booking._id.toString()}`,
      }),
      expect.anything(),
    );
    expect(t.refundsService.dispatchRefund).toHaveBeenCalledTimes(2);
  });

  it('never refunds more than is still refundable (part of it was refunded by an earlier change)', async () => {
    const booking = makeBooking({ totalPrice: 500, changePayments: [] });
    // 100 of the 600 original was refunded when the fare dropped: 500 left
    const t = build(booking, { [original.toString()]: 50000 });
    const res = await t.service.cancel(
      userId.toString(),
      booking._id.toString(),
      { confirm: true },
    );
    expect(res.refundAmount).toBe(500);
    expect(t.refundsService.recordBookingRefund).toHaveBeenCalledWith(
      expect.objectContaining({ payments: [original], amount: 500 }),
      expect.anything(),
    );
  });

  it('refunds 0 and records no refund when nothing is refundable any more', async () => {
    const booking = makeBooking({ changePayments: [] });
    const t = build(booking, { [original.toString()]: 0 });
    const res = await t.service.cancel(
      userId.toString(),
      booking._id.toString(),
      { confirm: true },
    );
    expect(res.refundAmount).toBe(0);
    expect(res.refund).toBeNull();
    expect(t.refundsService.recordBookingRefund).not.toHaveBeenCalled();
  });

  it('keeps the old single-payment path for a booking that was never changed', async () => {
    const booking = makeBooking({
      changeCount: 0,
      changePayments: [],
      totalPrice: 600,
    });
    const t = build(booking, {});
    t.refundsService.recordRefund.mockResolvedValue({
      _id: new Types.ObjectId(),
      status: RefundStatus.PENDING,
      amount: 600,
      currency: 'USD',
    });
    await t.service.cancel(userId.toString(), booking._id.toString(), {
      confirm: true,
    });
    expect(t.refundsService.recordRefund).toHaveBeenCalledTimes(1);
    expect(t.refundsService.recordBookingRefund).not.toHaveBeenCalled();
  });
});
