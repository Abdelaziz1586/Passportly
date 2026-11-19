import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  BookingStatus,
  CabinClass,
  PassengerType,
  PaymentStatus,
  Role,
  TripType,
} from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { effectiveStatus } from './flight-booking-view';
import { FlightBookingViewService } from './flight-booking-view.service';

interface Chain<T> extends PromiseLike<T> {
  lean(): Chain<T>;
}

function query<T>(result: T): Chain<T> {
  const q: Chain<T> = {
    lean: () => q,
    then: (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return q;
}

const ownerId = new Types.ObjectId();
const airlineId = new Types.ObjectId();
const otherAirlineId = new Types.ObjectId();
const paymentId = new Types.ObjectId();

const cairo = {
  _id: new Types.ObjectId(),
  iataCode: 'CAI',
  name: 'Cairo Intl',
  timezone: 'Africa/Cairo',
};
const dubai = {
  _id: new Types.ObjectId(),
  iataCode: 'DXB',
  name: 'Dubai Intl',
  timezone: 'Asia/Dubai',
};
const flight = {
  _id: new Types.ObjectId(),
  airline: airlineId,
  flightNumber: 'NA100',
  status: 'SCHEDULED',
  departureAirport: cairo._id,
  arrivalAirport: dubai._id,
};
const otherFlight = {
  _id: new Types.ObjectId(),
  airline: otherAirlineId,
  flightNumber: 'OA200',
  status: 'SCHEDULED',
  departureAirport: dubai._id,
  arrivalAirport: cairo._id,
};
const airline = { _id: airlineId, name: 'Nile Air', iataCode: 'NA' };
const otherAirline = { _id: otherAirlineId, name: 'Other Air', iataCode: 'OA' };

function makeLeg(flightId: Types.ObjectId) {
  return {
    flight: flightId,
    cabinClass: CabinClass.ECONOMY,
    departureTime: new Date('2026-12-01T12:30:00Z'),
    arrivalTime: new Date('2026-12-01T16:30:00Z'),
    unitPrice: 300,
    seatNumbers: ['12A'],
  };
}

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    user: ownerId,
    bookingReference: 'ABCD2345',
    status: BookingStatus.CONFIRMED,
    tripType: TripType.ONE_WAY,
    holdExpiresAt: new Date(Date.now() + 60_000),
    legs: [makeLeg(flight._id)],
    passengers: [
      {
        _id: new Types.ObjectId(),
        firstName: 'Layla',
        lastName: 'Hassan',
        type: PassengerType.ADULT,
        dateOfBirth: new Date('1990-05-17T00:00:00Z'),
        gender: 'FEMALE',
        passportNumber: 'A12345678',
        passportExpiry: new Date('2032-01-01T00:00:00Z'),
        nationality: 'EG',
        extraBaggageCount: 1,
        extraBaggageFee: 40,
        eTicketNumber: 'ETKABCD234501',
        seatAssignments: ['12A'],
      },
    ],
    passengerCounts: {
      adults: 1,
      children: 0,
      infants: 0,
      totalSeatsRequired: 1,
    },
    baseFareTotal: 300,
    extraBaggageTotal: 40,
    taxesAndFees: 0,
    totalPrice: 340,
    currency: 'USD',
    policySnapshot: { legs: [] },
    policyAcceptedAt: new Date('2026-11-19T10:00:00Z'),
    payment: paymentId,
    confirmedAt: new Date('2026-11-19T10:05:00Z'),
    createdAt: new Date('2026-11-19T10:00:00Z'),
    updatedAt: new Date('2026-11-19T10:05:00Z'),
    ...overrides,
  };
}

function build(booking: ReturnType<typeof makeBooking> | null) {
  const bookingModel = { findById: jest.fn(() => query(booking)) };
  const flightModel = {
    find: jest.fn(() => query([flight, otherFlight])),
    exists: jest.fn().mockResolvedValue(null),
  };
  const airlineModel = { find: jest.fn(() => query([airline, otherAirline])) };
  const airportModel = { find: jest.fn(() => query([cairo, dubai])) };
  const paymentModel = {
    findById: jest.fn(() =>
      query({
        _id: paymentId,
        status: PaymentStatus.SUCCEEDED,
        amount: 340,
        currency: 'USD',
        paidAt: new Date('2026-11-19T10:04:00Z'),
        stripePaymentIntentId: 'pi_secret_ish',
        policyAcceptedAt: new Date(),
      }),
    ),
  };
  const refundModel = { findOne: jest.fn(() => query<unknown>(null)) };
  const service = new FlightBookingViewService(
    bookingModel as never,
    flightModel as never,
    airlineModel as never,
    airportModel as never,
    paymentModel as never,
    refundModel as never,
  );
  return {
    service,
    bookingModel,
    flightModel,
    airlineModel,
    paymentModel,
    refundModel,
  };
}

const owner: AuthenticatedUser = {
  userId: ownerId.toString(),
  email: 'o@example.com',
  role: Role.REGISTERED_USER,
  jti: 'j',
};
const moderator: AuthenticatedUser = {
  userId: new Types.ObjectId().toString(),
  email: 'm@example.com',
  role: Role.AIRLINE_MODERATOR,
  jti: 'j',
  assignedProviderType: 'airline',
  assignedProviderId: airlineId.toString(),
};

describe('FlightBookingViewService.getBooking', () => {
  it('returns legs, passengers, totals, policies and a payment summary to the owner', async () => {
    const booking = makeBooking();
    const { service } = build(booking);

    const view = await service.getBooking(owner, booking._id.toString());

    expect(view.id).toBe(booking._id.toString());
    expect(view.status).toBe(BookingStatus.CONFIRMED);
    expect(view.legs).toEqual([
      {
        segment: 1,
        flightId: flight._id.toString(),
        flightNumber: 'NA100',
        airline: { id: airlineId.toString(), name: 'Nile Air', iataCode: 'NA' },
        flightStatus: 'SCHEDULED',
        departureAirport: {
          iataCode: 'CAI',
          name: 'Cairo Intl',
          timezone: 'Africa/Cairo',
        },
        arrivalAirport: {
          iataCode: 'DXB',
          name: 'Dubai Intl',
          timezone: 'Asia/Dubai',
        },
        cabinClass: CabinClass.ECONOMY,
        departureTime: new Date('2026-12-01T12:30:00Z'),
        arrivalTime: new Date('2026-12-01T16:30:00Z'),
        unitPrice: 300,
        seatNumbers: ['12A'],
      },
    ]);
    expect(view.passengers[0]).toMatchObject({
      firstName: 'Layla',
      passportNumber: '*****5678',
      eTicketNumber: 'ETKABCD234501',
      extraBaggageFee: 40,
      dateOfBirth: new Date('1990-05-17T00:00:00Z'),
    });
    expect(view.totalPrice).toBe(340);
    expect(view.policies).toEqual({ legs: [] });
    expect(view.payment).toEqual({
      id: paymentId.toString(),
      status: PaymentStatus.SUCCEEDED,
      amount: 340,
      currency: 'USD',
      paidAt: new Date('2026-11-19T10:04:00Z'),
    });
  });

  it('never exposes the full passport number, the Stripe intent id or the user id', async () => {
    const booking = makeBooking();
    const { service } = build(booking);

    const json = JSON.stringify(
      await service.getBooking(owner, booking._id.toString()),
    );

    expect(json).not.toContain('A12345678');
    expect(json).not.toContain('pi_secret_ish');
    expect(json).not.toContain(ownerId.toString());
    expect(json).not.toContain('policyAcceptedBy');
  });

  it("is a 404 for someone else's booking, a malformed id and an unknown id", async () => {
    const booking = makeBooking();
    const { service, bookingModel } = build(booking);

    await expect(
      service.getBooking(
        { ...owner, userId: new Types.ObjectId().toString() },
        booking._id.toString(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getBooking(owner, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(bookingModel.findById).toHaveBeenCalledTimes(1);
    const missing = build(null);
    await expect(
      missing.service.getBooking(owner, new Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets an admin read any booking in full', async () => {
    const booking = makeBooking();
    const { service } = build(booking);

    const view = await service.getBooking(
      { ...owner, userId: new Types.ObjectId().toString(), role: Role.ADMIN },
      booking._id.toString(),
    );

    expect(view.totalPrice).toBe(340);
    expect(view.payment?.status).toBe(PaymentStatus.SUCCEEDED);
  });

  it('gives an airline moderator the manifest of their own legs only: no prices, payment, policies or personal details', async () => {
    const booking = makeBooking({
      tripType: TripType.ROUND_TRIP,
      legs: [makeLeg(flight._id), makeLeg(otherFlight._id)],
    });
    const { service, flightModel, paymentModel } = build(booking);
    flightModel.exists.mockResolvedValue({ _id: flight._id });

    const view = await service.getBooking(moderator, booking._id.toString());

    expect(view.legs.map((leg) => leg.flightNumber)).toEqual(['NA100']);
    expect(view.legs[0].unitPrice).toBeNull();
    // seats of the moderator's own leg come from the leg, not from the passenger's all-legs list
    expect(view.legs[0].seatNumbers).toEqual(['12A']);
    expect(view.passengers[0].seatAssignments).toEqual([]);
    // the airline rule is enforced against the assigned airline and the booking's flights
    const [existsFilter] = flightModel.exists.mock.calls[0] as unknown as [
      { _id: { $in: Types.ObjectId[] }; airline: Types.ObjectId },
    ];
    expect(existsFilter.airline.equals(airlineId)).toBe(true);
    expect(existsFilter._id.$in.map(String).sort()).toEqual(
      [flight._id, otherFlight._id].map(String).sort(),
    );
    expect(view).toMatchObject({
      baseFareTotal: null,
      extraBaggageTotal: null,
      taxesAndFees: null,
      totalPrice: null,
      policies: null,
      policyAcceptedAt: null,
      refundAmount: null,
      payment: null,
    });
    expect(view.passengers[0]).toMatchObject({
      firstName: 'Layla',
      eTicketNumber: 'ETKABCD234501',
      passportNumber: '*****5678',
      dateOfBirth: null,
      gender: null,
      passportExpiry: null,
      nationality: null,
      extraBaggageFee: null,
    });
    expect(paymentModel.findById).not.toHaveBeenCalled();
  });

  it.each([
    { assignedProviderId: undefined },
    { assignedProviderType: 'hotel' as const },
    { assignedProviderId: 'not-an-id' },
  ])(
    'gives a moderator without a valid airline assignment 404 %j',
    async (override) => {
      const booking = makeBooking();
      const { service, flightModel } = build(booking);

      await expect(
        service.getBooking(
          { ...moderator, ...override },
          booking._id.toString(),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(flightModel.exists).not.toHaveBeenCalled();
    },
  );

  it('gives a moderator of another airline 404', async () => {
    const booking = makeBooking();
    const { service } = build(booking);

    await expect(
      service.getBooking(
        { ...moderator, assignedProviderId: otherAirlineId.toString() },
        booking._id.toString(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports a lapsed hold as EXPIRED, never as pending', async () => {
    const booking = makeBooking({
      status: BookingStatus.PENDING_PAYMENT,
      holdExpiresAt: new Date(Date.now() - 1000),
    });
    const { service } = build(booking);

    const view = await service.getBooking(owner, booking._id.toString());

    expect(view.status).toBe(BookingStatus.EXPIRED);
  });

  it('has no payment summary and no policies before the passenger details were submitted', async () => {
    const booking = makeBooking({
      status: BookingStatus.PENDING_PAYMENT,
      payment: null,
      passengers: [],
      policySnapshot: undefined,
      policyAcceptedAt: undefined,
      confirmedAt: undefined,
    });
    const { service, paymentModel } = build(booking);

    const view = await service.getBooking(owner, booking._id.toString());

    expect(view.payment).toBeNull();
    expect(view.policies).toBeNull();
    expect(view.passengers).toEqual([]);
    expect(view.confirmedAt).toBeNull();
    expect(paymentModel.findById).not.toHaveBeenCalled();
  });

  it('shows the refund of a cancelled booking with its status (PAY-03)', async () => {
    const booking = makeBooking({ status: BookingStatus.CANCELLED });
    const { service, refundModel } = build(booking);
    const refundId = new Types.ObjectId();
    refundModel.findOne.mockReturnValue(
      query({
        _id: refundId,
        status: 'PENDING',
        amount: 170,
        currency: 'USD',
        reason: 'Cancelled by the traveller',
        policyCalculationNotes: '10 day(s) before departure: 50%',
        stripeRefundId: 're_secret',
      }),
    );

    const view = await service.getBooking(owner, booking._id.toString());

    expect(view.refund).toEqual({
      id: refundId.toString(),
      status: 'PENDING',
      amount: 170,
      currency: 'USD',
      reason: 'Cancelled by the traveller',
      policyCalculationNotes: '10 day(s) before departure: 50%',
      processedAt: null,
    });
    expect(JSON.stringify(view)).not.toContain('re_secret');
    const [filter] = refundModel.findOne.mock.calls[0] as unknown as [
      { bookingType: string; bookingId: Types.ObjectId },
    ];
    expect(filter.bookingType).toBe('flight');
    expect(filter.bookingId.equals(booking._id)).toBe(true);
  });

  it('has no refund when none was issued, and a moderator never sees or loads one', async () => {
    const booking = makeBooking();
    const { service, refundModel, flightModel } = build(booking);

    expect(
      (await service.getBooking(owner, booking._id.toString())).refund,
    ).toBeNull();

    flightModel.exists.mockResolvedValue({ _id: flight._id });
    refundModel.findOne.mockClear();
    const view = await service.getBooking(moderator, booking._id.toString());
    expect(view.refund).toBeNull();
    expect(refundModel.findOne).not.toHaveBeenCalled();
  });

  it('shows cancellation details of a cancelled booking', async () => {
    const booking = makeBooking({
      status: BookingStatus.CANCELLED,
      cancelledAt: new Date('2026-11-25T08:00:00Z'),
      cancellationReason: 'Changed plans',
      refundAmount: 170,
    });
    const { service } = build(booking);

    const view = await service.getBooking(owner, booking._id.toString());

    expect(view).toMatchObject({
      status: BookingStatus.CANCELLED,
      cancelledAt: new Date('2026-11-25T08:00:00Z'),
      cancellationReason: 'Changed plans',
      refundAmount: 170,
    });
  });

  it('still shows the booking when a flight record vanished (leg without flight details)', async () => {
    const booking = makeBooking();
    const { service, flightModel } = build(booking);
    flightModel.find.mockReturnValue(query([]));

    const view = await service.getBooking(owner, booking._id.toString());

    expect(view.legs[0]).toMatchObject({
      flightId: flight._id.toString(),
      flightNumber: null,
      airline: null,
      flightStatus: null,
      departureAirport: null,
      arrivalAirport: null,
      unitPrice: 300,
    });
  });

  it("a vanished leg of another airline does not block a moderator's view", async () => {
    const booking = makeBooking({
      legs: [makeLeg(flight._id), makeLeg(otherFlight._id)],
    });
    const { service, flightModel } = build(booking);
    flightModel.find.mockReturnValue(query([flight]));
    flightModel.exists.mockResolvedValue({ _id: flight._id });

    const view = await service.getBooking(moderator, booking._id.toString());

    expect(view.legs.map((leg) => leg.flightNumber)).toEqual(['NA100']);
  });

  it('shows the status of a cancelled flight on its leg', async () => {
    const booking = makeBooking();
    const { service, flightModel } = build(booking);
    flightModel.find.mockReturnValue(
      query([{ ...flight, status: 'CANCELLED' }]),
    );

    const view = await service.getBooking(owner, booking._id.toString());

    expect(view.legs[0].flightStatus).toBe('CANCELLED');
  });
});

describe('effectiveStatus', () => {
  const now = new Date('2026-11-19T12:00:00Z');
  const past = new Date('2026-11-19T11:59:00Z');
  const future = new Date('2026-11-19T12:05:00Z');

  it.each([
    [BookingStatus.PENDING_PAYMENT, past, BookingStatus.EXPIRED],
    [BookingStatus.HELD, past, BookingStatus.EXPIRED],
    [BookingStatus.PENDING_PAYMENT, future, BookingStatus.PENDING_PAYMENT],
    [BookingStatus.PENDING_PAYMENT, undefined, BookingStatus.PENDING_PAYMENT],
    [BookingStatus.CONFIRMED, past, BookingStatus.CONFIRMED],
    [BookingStatus.CANCELLED, past, BookingStatus.CANCELLED],
  ])('%s with hold %s -> %s', (status, hold, expected) => {
    expect(effectiveStatus(status, hold, now)).toBe(expected);
  });
});
