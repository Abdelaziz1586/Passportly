import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingType, PaymentStatus, RefundStatus } from '../../common/enums';
import { RefundsService } from './refunds.service';

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

const userId = new Types.ObjectId();
const bookingId = new Types.ObjectId();

interface StoredRefund {
  _id: Types.ObjectId;
  payment: Types.ObjectId;
  amount: number;
  status: RefundStatus;
  key?: string;
}

/** An in-memory stand-in for the two collections, enough to see the rules. */
function build(
  payments: Array<{
    _id: Types.ObjectId;
    amount: number;
    status?: PaymentStatus;
  }>,
  refunds: StoredRefund[] = [],
) {
  const refundModel = {
    findOne: jest.fn((filter: { payment: Types.ObjectId; key?: string }) =>
      query(
        refunds.find(
          (r) =>
            r.payment.equals(filter.payment) &&
            (filter.key === undefined || r.key === filter.key),
        ) ?? null,
      ),
    ),
    find: jest.fn((filter: { payment: Types.ObjectId }) =>
      query(
        refunds.filter(
          (r) =>
            r.payment.equals(filter.payment) &&
            r.status !== RefundStatus.FAILED,
        ),
      ),
    ),
    create: jest.fn((docs: Array<Omit<StoredRefund, '_id'>>) => {
      const made = docs.map((d) => ({ _id: new Types.ObjectId(), ...d }));
      refunds.push(...made);
      return Promise.resolve(made);
    }),
  };
  const paymentModel = {
    findById: jest.fn((id: Types.ObjectId) =>
      query(
        payments
          .map((p) => ({
            currency: 'USD',
            status: PaymentStatus.SUCCEEDED,
            ...p,
          }))
          .find((p) => p._id.equals(id)) ?? null,
      ),
    ),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const service = new RefundsService(
    refundModel as never,
    paymentModel as never,
    { stripe: null } as never,
    { createNotification: jest.fn() } as never,
  );
  return { service, refundModel, paymentModel, refunds };
}

const base = {
  user: userId,
  bookingType: BookingType.FLIGHT,
  bookingId,
  currency: 'USD',
  reason: 'r',
  notes: 'n',
};

describe('RefundsService keyed refunds (several per payment)', () => {
  it('lets a payment have several refunds as long as the total stays within it', async () => {
    const payment = { _id: new Types.ObjectId(), amount: 600 };
    const t = build([payment]);
    const a = await t.service.recordRefund({
      ...base,
      payment: payment._id,
      amount: 100,
      key: 'change-1',
    });
    const b = await t.service.recordRefund({
      ...base,
      payment: payment._id,
      amount: 250,
      key: 'cancel-1',
    });
    expect(a.key).toBe('change-1');
    expect(b.key).toBe('cancel-1');
    expect(t.refunds).toHaveLength(2);
    // 100 + 250 = 350 of 600; 300 more would pass the payment
    await expect(
      t.service.recordRefund({
        ...base,
        payment: payment._id,
        amount: 300,
        key: 'x',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      t.service.recordRefund({
        ...base,
        payment: payment._id,
        amount: 250,
        key: 'y',
      }),
    ).resolves.toMatchObject({ amount: 250 });
  });

  it('returns the same refund for the same key (idempotent)', async () => {
    const payment = { _id: new Types.ObjectId(), amount: 600 };
    const t = build([payment]);
    const a = await t.service.recordRefund({
      ...base,
      payment: payment._id,
      amount: 100,
      key: 'change-1',
    });
    const again = await t.service.recordRefund({
      ...base,
      payment: payment._id,
      amount: 100,
      key: 'change-1',
    });
    expect(again).toBe(a);
    expect(t.refundModel.create).toHaveBeenCalledTimes(1);
  });

  it('gives the money of a FAILED refund back', async () => {
    const payment = { _id: new Types.ObjectId(), amount: 100 };
    const t = build(
      [payment],
      [
        {
          _id: new Types.ObjectId(),
          payment: payment._id,
          amount: 100,
          status: RefundStatus.FAILED,
          key: 'a',
        },
      ],
    );
    await expect(
      t.service.recordRefund({
        ...base,
        payment: payment._id,
        amount: 100,
        key: 'b',
      }),
    ).resolves.toMatchObject({ amount: 100 });
  });

  it('writes to the payment so two concurrent refunds of it conflict and one retries', async () => {
    const payment = { _id: new Types.ObjectId(), amount: 600 };
    const t = build([payment]);
    await t.service.recordRefund({
      ...base,
      payment: payment._id,
      amount: 100,
      key: 'k',
    });
    expect(t.paymentModel.updateOne).toHaveBeenCalledWith(
      { _id: payment._id },
      { $inc: { 'metadata.refundWrites': 1 } },
      expect.anything(),
    );
  });

  it('refuses unrefundable payments, another currency, zero and unknown payments', async () => {
    const paid = { _id: new Types.ObjectId(), amount: 100 };
    const refunded = {
      _id: new Types.ObjectId(),
      amount: 100,
      status: PaymentStatus.REFUNDED,
    };
    const t = build([paid, refunded]);
    await expect(
      t.service.recordRefund({
        ...base,
        payment: refunded._id,
        amount: 10,
        key: 'k',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      t.service.recordRefund({
        ...base,
        payment: new Types.ObjectId(),
        amount: 10,
        key: 'k',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      t.service.recordRefund({
        ...base,
        payment: paid._id,
        amount: 10,
        currency: 'EUR',
        key: 'k',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      t.service.recordRefund({
        ...base,
        payment: paid._id,
        amount: 0,
        key: 'k',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('without a key a payment still has at most one refund (old rule)', async () => {
    const payment = { _id: new Types.ObjectId(), amount: 600 };
    const t = build([payment]);
    const first = await t.service.recordRefund({
      ...base,
      payment: payment._id,
      amount: 100,
    });
    const second = await t.service.recordRefund({
      ...base,
      payment: payment._id,
      amount: 300,
    });
    expect(second).toBe(first);
    expect(t.paymentModel.updateOne).not.toHaveBeenCalled();
  });
});

describe('RefundsService.recordBookingRefund', () => {
  it('refunds the newest payment first and spills the rest to the older one', async () => {
    const original = { _id: new Types.ObjectId(), amount: 600 };
    const extra = { _id: new Types.ObjectId(), amount: 100 };
    const t = build([original, extra]);
    const refunds = await t.service.recordBookingRefund({
      ...base,
      payments: [extra._id, original._id],
      amount: 350,
      key: 'cancel-1',
    });
    expect(refunds.map((r) => [r.payment.toString(), r.amount])).toEqual([
      [extra._id.toString(), 100],
      [original._id.toString(), 250],
    ]);
    expect(refunds.map((r) => r.key)).toEqual([
      `cancel-1:${extra._id.toString()}`,
      `cancel-1:${original._id.toString()}`,
    ]);
  });

  it('counts refunds already made and returns the same refunds when repeated', async () => {
    const original = { _id: new Types.ObjectId(), amount: 600 };
    const t = build(
      [original],
      [
        {
          _id: new Types.ObjectId(),
          payment: original._id,
          amount: 100,
          status: RefundStatus.SUCCEEDED,
          key: 'change-1',
        },
      ],
    );
    const first = await t.service.recordBookingRefund({
      ...base,
      payments: [original._id],
      amount: 500,
      key: 'cancel-1',
    });
    expect(first).toHaveLength(1);
    const again = await t.service.recordBookingRefund({
      ...base,
      payments: [original._id],
      amount: 500,
      key: 'cancel-1',
    });
    expect(again[0]).toBe(first[0]);
    expect(t.refunds).toHaveLength(2);
  });

  it('throws 409 when the payments cannot cover the amount', async () => {
    const original = { _id: new Types.ObjectId(), amount: 100 };
    const t = build([original]);
    await expect(
      t.service.recordBookingRefund({
        ...base,
        payments: [original._id],
        amount: 150,
        key: 'k',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('skips a payment that has nothing left to refund', async () => {
    const empty = {
      _id: new Types.ObjectId(),
      amount: 100,
      status: PaymentStatus.REFUNDED,
    };
    const original = { _id: new Types.ObjectId(), amount: 600 };
    const t = build([empty, original]);
    const refunds = await t.service.recordBookingRefund({
      ...base,
      payments: [empty._id, original._id],
      amount: 50,
      key: 'k',
    });
    expect(refunds.map((r) => r.payment.toString())).toEqual([
      original._id.toString(),
    ]);
  });
});
