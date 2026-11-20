import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  ClientSession,
  Connection,
  isValidObjectId,
  Model,
  Types,
} from 'mongoose';
import {
  BookingStatus,
  BookingType,
  CabinClass,
  FlightStatus,
  NotificationType,
  PaymentPurpose,
  PaymentStatus,
  TripType,
} from '../../common/enums';
import { NotificationsService } from '../notifications/notifications.service';
import {
  PaidPaymentHandler,
  PaidPaymentOutcome,
  PaymentPurposeRegistry,
} from '../payments/payment-purpose-handlers';
import {
  OPEN_PAYMENT_STATUSES,
  PaymentsService,
} from '../payments/payments.service';
import { RefundsService } from '../payments/refunds.service';
import { Payment, PaymentDocument } from '../payments/schemas/payment.schema';
import {
  ChangeFlightDto,
  ChangeFlightPreviewDto,
} from './dto/change-flight.dto';
import type {
  ChangeFlightResponseDto,
  ChangeLegDto,
  ChangeQuoteResponseDto,
} from './dto/change-flight-response.dto';
import {
  existingLegFaresCents,
  extraBaggageCents,
  legFareCents,
  quoteTotals,
} from './flight-change-pricing';
import { buildPolicySnapshot } from './flight-booking-details';
import { Airline } from './schemas/airline.schema';
import { CabinInventory } from './schemas/cabin-inventory.schema';
import {
  FlightChange,
  FlightChangeDocument,
  FlightChangePlan,
  FlightChangeStatus,
} from './schemas/flight-change.schema';
import { FlightBooking } from './schemas/flight-booking.schema';
import { FlightSeatClaim } from './schemas/flight-seat-claim.schema';
import { Flight } from './schemas/flight.schema';

/** How long the traveller has to pay the fare difference; after that nothing changes. */
export const CHANGE_PAYMENT_MINUTES = 10;
const BOOKABLE_FLIGHT_STATUSES: FlightStatus[] = [
  FlightStatus.SCHEDULED,
  FlightStatus.DELAYED,
];

type WithId = { _id: Types.ObjectId };
type StoredBooking = Omit<FlightBooking, 'legs' | 'passengers'> &
  WithId & {
    legs: Array<FlightBooking['legs'][number] & WithId>;
    passengers: Array<FlightBooking['passengers'][number] & WithId>;
  };
type StoredClaim = FlightSeatClaim & WithId;
type CabinLean = CabinInventory & WithId;

interface Draft {
  booking: StoredBooking;
  plan: FlightChangePlan;
  differenceCents: number;
  oldTotalCents: number;
  newTotalCents: number;
  legs: ChangeLegDto[];
}

type ApplyResult =
  { ok: true; booking: StoredBooking } | { ok: false; reason: string };

/**
 * FLT-27: change the flight(s) of a CONFIRMED booking (same route and cabin,
 * before the outbound departure). The booking stays CONFIRMED the whole time
 * (GEN-11): nothing changes status, only its legs, seats, totals and policies.
 *
 * - New fare equal: the legs are swapped at once.
 * - New fare lower: swapped at once and the difference is refunded through the
 *   Stripe Refunds API (the refund engine, several refunds per payment).
 * - New fare higher: the booking keeps its old flights and seats while the
 *   difference is paid through a PaymentIntent; only the signed webhook applies
 *   the change. If the new flight has no seats left by then, the whole
 *   difference is refunded and the booking stays as it was.
 *
 * Swapping runs in one transaction: new seats taken with a conditional update
 * (never oversold), old seats returned, seat choices of replaced legs freed,
 * legs, totals and the policy copy of the new airline written to the booking.
 */
@Injectable()
export class FlightChangeService implements OnModuleInit, PaidPaymentHandler {
  private readonly logger = new Logger(FlightChangeService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    @InjectModel(Flight.name) private readonly flightModel: Model<Flight>,
    @InjectModel(Airline.name) private readonly airlineModel: Model<Airline>,
    @InjectModel(CabinInventory.name)
    private readonly cabinModel: Model<CabinInventory>,
    @InjectModel(FlightChange.name)
    private readonly changeModel: Model<FlightChange>,
    @InjectModel(FlightSeatClaim.name)
    private readonly claimModel: Model<FlightSeatClaim>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectConnection() private readonly connection: Connection,
    private readonly paymentsService: PaymentsService,
    private readonly refundsService: RefundsService,
    private readonly notificationsService: NotificationsService,
    private readonly registry: PaymentPurposeRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(PaymentPurpose.FLIGHT_CHANGE, this);
  }

  /** What the change would cost and which policies come with it. Changes nothing. */
  async preview(
    userId: string,
    bookingId: string,
    dto: ChangeFlightPreviewDto,
  ): Promise<ChangeQuoteResponseDto> {
    const draft = await this.buildDraft(userId, bookingId, dto, new Date());
    return this.toQuote(draft);
  }

  async change(
    userId: string,
    bookingId: string,
    dto: ChangeFlightDto,
  ): Promise<ChangeFlightResponseDto> {
    const now = new Date();
    const draft = await this.buildDraft(userId, bookingId, dto, now);
    if (
      dto.expectedDifference !== undefined &&
      Math.round(dto.expectedDifference * 100) !== draft.differenceCents
    ) {
      throw new ConflictException(
        `The price changed from ${dto.expectedDifference.toFixed(2)} to ${(draft.differenceCents / 100).toFixed(2)} ${draft.booking.currency}: preview the change again`,
      );
    }
    await this.clearStalePending(draft.booking, now);
    return draft.differenceCents > 0
      ? this.startPaidChange(draft, now)
      : this.applyNow(draft, now);
  }

  // ---------------------------------------------------------------- higher fare

  private async startPaidChange(
    draft: Draft,
    now: Date,
  ): Promise<ChangeFlightResponseDto> {
    const booking = draft.booking;
    const expiresAt = new Date(now.getTime() + CHANGE_PAYMENT_MINUTES * 60_000);
    let change: FlightChangeDocument;
    try {
      change = await this.changeModel.create({
        booking: booking._id,
        user: booking.user,
        status: FlightChangeStatus.PENDING_PAYMENT,
        oldTotal: draft.oldTotalCents / 100,
        newTotal: draft.newTotalCents / 100,
        difference: draft.differenceCents / 100,
        currency: booking.currency,
        plan: draft.plan,
        policyAcceptedAt: now,
        expiresAt,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'A change of this booking is already awaiting payment',
        );
      }
      throw error;
    }

    let created: Awaited<ReturnType<PaymentsService['createChangePayment']>>;
    try {
      created = await this.paymentsService.createChangePayment({
        user: booking.user,
        booking,
        change: change._id,
        amount: draft.differenceCents / 100,
        currency: booking.currency,
        policyAcceptedAt: now,
        expiresAt,
      });
    } catch (error) {
      await this.changeModel.deleteOne({ _id: change._id });
      throw error;
    }
    await this.changeModel.updateOne(
      { _id: change._id },
      { $set: { payment: created.payment._id } },
    );
    if (!created.intent.client_secret) {
      throw new ConflictException(
        'The payment provider returned no client secret',
      );
    }
    return {
      ...this.toQuote(draft),
      changeId: change._id.toString(),
      changeStatus: 'PENDING_PAYMENT',
      bookingStatus: BookingStatus.CONFIRMED,
      payment: {
        paymentId: created.payment._id.toString(),
        clientSecret: created.intent.client_secret,
        stripePaymentIntentId: created.intent.id,
        amount: created.payment.amount,
        currency: created.payment.currency,
        status: created.payment.status,
        expiresAt,
      },
      refund: null,
    };
  }

  // ------------------------------------------------------- equal or lower fare

  private async applyNow(
    draft: Draft,
    now: Date,
  ): Promise<ChangeFlightResponseDto> {
    const booking = draft.booking;
    const outcome = await this.connection.transaction(async (session) => {
      const applied = await this.applyPlan(
        booking._id,
        booking.user,
        draft.plan,
        now,
        session,
        null,
      );
      if (!applied.ok) throw new ConflictException(applied.reason);
      const [change] = await this.changeModel.create(
        [
          {
            booking: booking._id,
            user: booking.user,
            status: FlightChangeStatus.APPLIED,
            oldTotal: draft.oldTotalCents / 100,
            newTotal: draft.newTotalCents / 100,
            difference: draft.differenceCents / 100,
            currency: booking.currency,
            plan: draft.plan,
            policyAcceptedAt: now,
            appliedAt: now,
          },
        ],
        { session },
      );
      const refunds =
        draft.differenceCents < 0
          ? await this.refundsService.recordBookingRefund(
              {
                payments: paymentsNewestFirst(applied.booking),
                user: booking.user,
                bookingType: BookingType.FLIGHT,
                bookingId: booking._id,
                amount: -draft.differenceCents / 100,
                currency: booking.currency,
                reason: 'Cheaper flight chosen when changing the booking',
                notes: `The new flights cost ${(-draft.differenceCents / 100).toFixed(2)} ${booking.currency} less than the old ones; the difference is refunded.`,
                key: `change-${change._id.toString()}`,
              },
              session,
            )
          : [];
      return { change, refunds };
    });

    // After the commit: send the money to Stripe; a failure leaves the refund PENDING for the job.
    let first = outcome.refunds[0] ?? null;
    for (const refund of outcome.refunds) {
      try {
        await this.refundsService.dispatchRefund(refund._id);
      } catch (error) {
        this.logger.error(
          `Could not send refund ${refund._id.toString()} to Stripe now`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    if (first) {
      first = (await this.refundsService.findRefund(first._id)) ?? first;
    }
    await this.notify(
      booking.user,
      NotificationType.BOOKING_CONFIRMED,
      'Flight changed',
      `Booking ${booking.bookingReference} now has your new flight(s).${draft.differenceCents < 0 ? ` A refund of ${(-draft.differenceCents / 100).toFixed(2)} ${booking.currency} has been requested.` : ''}`,
      booking._id,
    );
    return {
      ...this.toQuote(draft),
      changeId: outcome.change._id.toString(),
      changeStatus: 'APPLIED',
      bookingStatus: BookingStatus.CONFIRMED,
      payment: null,
      refund: first
        ? {
            id: first._id.toString(),
            status: first.status,
            amount: first.amount,
            currency: first.currency,
          }
        : null,
    };
  }

  // ----------------------------------------------- the payment webhook settles

  /** PaidPaymentHandler: the fare difference was paid (webhook transaction). */
  async settle(
    payment: PaymentDocument,
    paidAt: Date,
    session: ClientSession,
  ): Promise<PaidPaymentOutcome> {
    const change = payment.flightChange
      ? await this.changeModel
          .findOne({
            _id: payment.flightChange,
            status: FlightChangeStatus.PENDING_PAYMENT,
          })
          .session(session)
      : null;
    const user = payment.user;
    const refundOutcome = (reason: string): PaidPaymentOutcome => ({
      kind: 'refund',
      afterCommit: () =>
        this.notify(
          user,
          NotificationType.SYSTEM,
          'Flight change not applied',
          `Your flight change could not be applied (${reason}). The ${payment.amount.toFixed(2)} ${payment.currency} you paid is being refunded in full and your booking is unchanged.`,
          payment.changedFlightBooking ?? payment._id,
        ),
    });
    if (!change) return refundOutcome('the offer is no longer open');

    const fail = async (reason: string): Promise<PaidPaymentOutcome> => {
      await this.changeModel.updateOne(
        { _id: change._id },
        { $set: { status: FlightChangeStatus.FAILED, failureReason: reason } },
        { session },
      );
      return refundOutcome(reason);
    };
    if (change.expiresAt && paidAt.getTime() > change.expiresAt.getTime()) {
      return fail('the payment arrived after the offer ended');
    }

    const applied = await this.applyPlan(
      change.booking,
      change.user,
      change.plan,
      new Date(),
      session,
      payment._id,
    );
    if (!applied.ok) return fail(applied.reason);

    await this.changeModel.updateOne(
      { _id: change._id },
      {
        $set: {
          status: FlightChangeStatus.APPLIED,
          appliedAt: new Date(),
          payment: payment._id,
        },
      },
      { session },
    );
    return {
      kind: 'applied',
      afterCommit: () =>
        this.notify(
          user,
          NotificationType.BOOKING_CONFIRMED,
          'Flight changed',
          `We received ${payment.amount.toFixed(2)} ${payment.currency} and booking ${applied.booking.bookingReference} now has your new flight(s).`,
          applied.booking._id,
        ),
    };
  }

  // -------------------------------------------------------------- the swap

  /**
   * Swaps the legs of a CONFIRMED booking inside `session`. Writes nothing and
   * reports why when it cannot (booking changed, flight gone, no seats left), so a
   * caller that must keep its own writes (the webhook) can carry on and refund.
   */
  private async applyPlan(
    bookingId: Types.ObjectId,
    owner: Types.ObjectId,
    plan: FlightChangePlan,
    now: Date,
    session: ClientSession,
    paymentId: Types.ObjectId | null,
  ): Promise<ApplyResult> {
    const booking = (await this.bookingModel
      .findOne({ _id: bookingId, user: owner, status: BookingStatus.CONFIRMED })
      .session(session)
      .lean()) as unknown as StoredBooking | null;
    if (!booking)
      return { ok: false, reason: 'the booking is no longer confirmed' };
    if (booking.legs[0].departureTime.getTime() <= now.getTime()) {
      return { ok: false, reason: 'the booking has already departed' };
    }
    for (const replaced of plan.replaced) {
      const current = booking.legs[replaced.legIndex] as
        (typeof booking.legs)[number] | undefined;
      if (!current?._id.equals(replaced.fromLeg)) {
        return { ok: false, reason: 'the booking changed since the offer' };
      }
    }
    const newFlights = await this.flightModel
      .find({ _id: { $in: plan.replaced.map((r) => r.toFlight) } })
      .session(session)
      .lean();
    for (const replaced of plan.replaced) {
      const flight = newFlights.find((f) => f._id.equals(replaced.toFlight));
      if (
        !flight ||
        !BOOKABLE_FLIGHT_STATUSES.includes(flight.status) ||
        flight.departureTime.getTime() <= now.getTime()
      ) {
        return { ok: false, reason: 'the new flight can no longer be booked' };
      }
    }

    // New seats first, with a conditional update: never more seats booked than exist.
    const seats = plan.seatsRequired;
    const taken: Types.ObjectId[] = [];
    for (const replaced of plan.replaced) {
      const result = await this.cabinModel.updateOne(
        {
          _id: replaced.toCabin,
          isActive: true,
          availableSeats: { $gte: seats },
        },
        { $inc: { availableSeats: -seats } },
        { session },
      );
      if (result.modifiedCount !== 1) {
        for (const cabin of taken) {
          await this.cabinModel.updateOne(
            { _id: cabin },
            { $inc: { availableSeats: seats } },
            { session },
          );
        }
        return { ok: false, reason: 'the new flight has no seats left' };
      }
      taken.push(replaced.toCabin);
    }
    for (const replaced of plan.replaced) {
      await this.cabinModel.updateOne(
        { _id: replaced.fromCabin },
        { $inc: { availableSeats: seats } },
        { session },
      );
    }

    // Seats chosen on a replaced leg are freed; the display copies follow the claims that remain.
    const replacedLegIds = plan.replaced.map((r) => r.fromLeg);
    const claims = (await this.claimModel
      .find({ booking: booking._id })
      .session(session)
      .lean()) as unknown as StoredClaim[];
    const kept = claims.filter(
      (claim) => !replacedLegIds.some((id) => claim.leg.equals(id)),
    );
    await this.claimModel.deleteMany(
      { booking: booking._id, leg: { $in: replacedLegIds } },
      { session },
    );
    const legs = plan.legs.map((leg) => {
      const id = leg._id as Types.ObjectId;
      return {
        ...leg,
        seatNumbers: booking.passengers
          .map((p) =>
            kept.find((c) => c.leg.equals(id) && c.passenger.equals(p._id)),
          )
          .filter((c): c is StoredClaim => !!c)
          .map((c) => c.seat),
      };
    });
    const set: Record<string, unknown> = {
      legs,
      baseFareTotal: plan.baseFareTotal,
      extraBaggageTotal: plan.extraBaggageTotal,
      totalPrice: plan.totalPrice,
      policySnapshot: plan.policySnapshot,
    };
    booking.passengers.forEach((passenger, index) => {
      set[`passengers.${index}.seatAssignments`] = plan.legs
        .map((leg) =>
          kept.find(
            (c) =>
              c.leg.equals(leg._id as Types.ObjectId) &&
              c.passenger.equals(passenger._id),
          ),
        )
        .filter((c): c is StoredClaim => !!c)
        .map((c) => c.seat);
    });

    const filter: Record<string, unknown> = {
      _id: booking._id,
      user: owner,
      status: BookingStatus.CONFIRMED,
    };
    for (const replaced of plan.replaced) {
      filter[`legs.${replaced.legIndex}._id`] = replaced.fromLeg;
    }
    const updated = await this.bookingModel.findOneAndUpdate(
      filter,
      {
        $set: set,
        $inc: { changeCount: 1 },
        ...(paymentId ? { $push: { changePayments: paymentId } } : {}),
      },
      { returnDocument: 'after', session },
    );
    if (!updated) {
      // Cannot happen inside one snapshot; abort the whole transaction rather than half-apply.
      throw new ConflictException(
        'The booking changed while the flight was being changed',
      );
    }
    return {
      ok: true,
      booking: updated.toObject() as unknown as StoredBooking,
    };
  }

  // -------------------------------------------------------------- the quote

  private async buildDraft(
    userId: string,
    bookingId: string,
    dto: ChangeFlightPreviewDto,
    now: Date,
  ): Promise<Draft> {
    const booking = await this.loadChangeable(userId, bookingId, now);
    const seats = booking.passengerCounts.totalSeatsRequired;

    const indexes = dto.legs.map((leg) => leg.legIndex);
    if (new Set(indexes).size !== indexes.length) {
      throw new BadRequestException(
        'A leg can only be changed once per request',
      );
    }
    for (const index of indexes) {
      if (index >= booking.legs.length) {
        throw new BadRequestException(
          `This booking has no leg ${index} (it has ${booking.legs.length})`,
        );
      }
    }

    const oldFlights = await this.flightModel
      .find({ _id: { $in: booking.legs.map((l) => l.flight) } })
      .lean();
    const oldCabins = await this.cabinModel
      .find({ _id: { $in: booking.legs.map((l) => l.cabin) } })
      .lean();

    // Validate each replacement and load what it needs.
    const targets = new Map<
      number,
      {
        flight: (typeof oldFlights)[number];
        cabin: CabinLean;
        airline: Airline & WithId;
        oldFlight: (typeof oldFlights)[number];
      }
    >();
    for (const change of dto.legs) {
      const oldLeg = booking.legs[change.legIndex];
      const oldFlight = oldFlights.find((f) => f._id.equals(oldLeg.flight));
      if (!oldFlight) {
        throw new ConflictException(
          'A flight of this booking no longer exists',
        );
      }
      if (!isValidObjectId(change.flightId)) {
        throw new NotFoundException('Flight not found');
      }
      const flight = await this.flightModel.findById(change.flightId).lean();
      if (!flight) throw new NotFoundException('Flight not found');
      if (flight._id.equals(oldFlight._id)) {
        throw new BadRequestException(
          `Leg ${change.legIndex} is already on flight ${flight.flightNumber}`,
        );
      }
      if (
        !flight.departureAirport.equals(oldFlight.departureAirport) ||
        !flight.arrivalAirport.equals(oldFlight.arrivalAirport)
      ) {
        throw new BadRequestException(
          'The new flight must fly the same route (same origin and destination) as the leg it replaces',
        );
      }
      if (!BOOKABLE_FLIGHT_STATUSES.includes(flight.status)) {
        throw new ConflictException(
          `Flight ${flight.flightNumber} is ${flight.status} and cannot be booked`,
        );
      }
      if (flight.departureTime.getTime() <= now.getTime()) {
        throw new ConflictException(
          `Flight ${flight.flightNumber} has already departed`,
        );
      }
      const airline = (await this.airlineModel
        .findById(flight.airline)
        .lean()) as unknown as (Airline & WithId) | null;
      if (!airline?.isActive) {
        throw new ConflictException(
          `The airline for flight ${flight.flightNumber} is not accepting bookings`,
        );
      }
      const cabin = await this.loadCabin(flight._id, oldLeg.cabinClass);
      if (!cabin) {
        throw new NotFoundException(
          `${oldLeg.cabinClass} cabin is not offered on flight ${flight.flightNumber} (the cabin cannot change)`,
        );
      }
      if (cabin.currency !== booking.currency) {
        throw new BadRequestException(
          'The new flight is priced in another currency than this booking',
        );
      }
      if (cabin.availableSeats < seats) {
        throw new ConflictException(
          `Not enough ${cabin.cabinClass} seats on flight ${flight.flightNumber} (needed ${seats})`,
        );
      }
      const maxBags = airline.baggagePolicy.maxExtraBagsPerPassenger;
      if (typeof maxBags === 'number') {
        booking.passengers.forEach((passenger, index) => {
          if (passenger.extraBaggageCount > maxBags) {
            throw new BadRequestException(
              `Passenger ${index + 1} has ${passenger.extraBaggageCount} extra bags but ${airline.name} allows at most ${maxBags} per passenger`,
            );
          }
        });
      }
      targets.set(change.legIndex, { flight, cabin, airline, oldFlight });
    }

    // Round trip: the return must still leave after the outbound lands.
    const times = booking.legs.map((leg, index) => {
      const target = targets.get(index);
      return {
        departure: target ? target.flight.departureTime : leg.departureTime,
        arrival: target ? target.flight.arrivalTime : leg.arrivalTime,
      };
    });
    if (
      booking.tripType === TripType.ROUND_TRIP &&
      times[1].departure.getTime() <= times[0].arrival.getTime()
    ) {
      throw new BadRequestException(
        'The return flight must depart after the outbound flight arrives',
      );
    }

    // Pricing with the rules of the hold: fares, infants at 10%, bags at each leg's airline rate.
    const counts = booking.passengerCounts;
    const oldFares = existingLegFaresCents(
      booking.legs.map((leg) => ({
        fare: leg.fare,
        unitPrice: leg.unitPrice,
        childPrice: oldCabins.find((c) => c._id.equals(leg.cabin))?.childPrice,
      })),
      counts,
      booking.baseFareTotal,
    );
    const snapshotLegs = (
      booking.policySnapshot as
        | {
            legs?: Array<{
              baggagePolicy?: { extraBagFee: number; currency: string };
            }>;
          }
        | undefined
    )?.legs;
    const bagTerms = booking.legs.map((_leg, index) => {
      const target = targets.get(index);
      if (target) {
        return {
          extraBagFee: target.airline.baggagePolicy.extraBagFee,
          currency: target.airline.baggagePolicy.currency,
        };
      }
      const kept = snapshotLegs?.[index]?.baggagePolicy;
      if (!kept) {
        throw new ConflictException(
          'This booking has no stored baggage terms for a flight that stays; it cannot be changed online',
        );
      }
      return kept;
    });
    const legFares = booking.legs.map((_leg, index) => {
      const target = targets.get(index);
      return target ? legFareCents(target.cabin, counts) : oldFares[index];
    });
    const quote = quoteTotals({
      legFares,
      extraBaggage: extraBaggageCents(
        booking.passengers.map((p) => p.extraBaggageCount),
        bagTerms,
        booking.currency,
      ),
      taxesAndFees: booking.taxesAndFees ?? 0,
      oldTotal: booking.totalPrice,
    });

    // The result that gets stored and, once paid, applied.
    const legs = booking.legs.map((leg, index) => {
      const target = targets.get(index);
      if (!target) return { ...leg, fare: legFares[index] / 100 };
      return {
        _id: new Types.ObjectId(),
        flight: target.flight._id,
        cabin: target.cabin._id,
        cabinClass: target.cabin.cabinClass,
        departureTime: target.flight.departureTime,
        arrivalTime: target.flight.arrivalTime,
        unitPrice: target.cabin.basePrice,
        seatNumbers: [] as string[],
        fare: legFares[index] / 100,
      };
    });
    const snapshot = JSON.parse(
      JSON.stringify(booking.policySnapshot ?? { capturedAt: now, legs: [] }),
    ) as { legs: unknown[]; changedAt?: Date };
    for (const [index, target] of targets) {
      snapshot.legs[index] = buildPolicySnapshot(
        [
          {
            flightId: target.flight._id.toString(),
            airline: target.airline,
            cabin: target.cabin,
          },
        ],
        now,
      ).legs[0];
    }
    snapshot.changedAt = now;

    const plan: FlightChangePlan = {
      legs,
      baseFareTotal: quote.baseFareCents / 100,
      extraBaggageTotal: quote.extraBaggageCents / 100,
      totalPrice: quote.newTotalCents / 100,
      policySnapshot: snapshot,
      replaced: [...targets.entries()].map(([legIndex, target]) => ({
        legIndex,
        fromFlight: booking.legs[legIndex].flight,
        fromLeg: booking.legs[legIndex]._id,
        fromCabin: booking.legs[legIndex].cabin,
        toFlight: target.flight._id,
        toCabin: target.cabin._id,
      })),
      seatsRequired: seats,
    };

    const legViews: ChangeLegDto[] = [...targets.entries()].map(
      ([legIndex, target]) => {
        const oldLeg = booking.legs[legIndex];
        const policyLeg = snapshot.legs[legIndex] as {
          cancellationPolicy: {
            tiers: { daysBeforeDeparture: number; refundPercentage: number }[];
          };
        };
        return {
          legIndex,
          cabinClass: oldLeg.cabinClass,
          from: {
            flightId: target.oldFlight._id.toString(),
            flightNumber: target.oldFlight.flightNumber,
            departureTime: oldLeg.departureTime,
            arrivalTime: oldLeg.arrivalTime,
          },
          to: {
            flightId: target.flight._id.toString(),
            flightNumber: target.flight.flightNumber,
            departureTime: target.flight.departureTime,
            arrivalTime: target.flight.arrivalTime,
          },
          newFare: legFares[legIndex] / 100,
          newAirline: target.airline.name,
          newCancellationTiers: policyLeg.cancellationPolicy.tiers,
          newExtraBagFee: target.airline.baggagePolicy.extraBagFee,
        };
      },
    );

    return {
      booking,
      plan,
      differenceCents: quote.differenceCents,
      oldTotalCents: quote.oldTotalCents,
      newTotalCents: quote.newTotalCents,
      legs: legViews,
    };
  }

  private async loadCabin(
    flightId: Types.ObjectId,
    cabinClass: CabinClass,
  ): Promise<CabinLean | null> {
    return await this.cabinModel
      .findOne({ flight: flightId, cabinClass, isActive: true })
      .lean();
  }

  /** The owner's CONFIRMED booking whose outbound flight has not departed. */
  private async loadChangeable(
    userId: string,
    id: string,
    now: Date,
  ): Promise<StoredBooking> {
    if (!isValidObjectId(id) || !isValidObjectId(userId)) {
      throw new NotFoundException('Flight booking not found');
    }
    const booking = (await this.bookingModel
      .findOne({
        _id: new Types.ObjectId(id),
        user: new Types.ObjectId(userId),
      })
      .lean()) as unknown as StoredBooking | null;
    if (!booking) throw new NotFoundException('Flight booking not found');
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException(
        `Only a CONFIRMED booking can be changed (this one is ${booking.status})`,
      );
    }
    if (booking.legs[0].departureTime.getTime() <= now.getTime()) {
      throw new ConflictException(
        'This booking can no longer be changed: the first flight has departed',
      );
    }
    return booking;
  }

  /** One change awaiting payment per booking: an expired or failed one is replaced, a live one blocks. */
  private async clearStalePending(
    booking: StoredBooking,
    now: Date,
  ): Promise<void> {
    const pending = await this.changeModel
      .findOne({
        booking: booking._id,
        status: FlightChangeStatus.PENDING_PAYMENT,
      })
      .lean();
    if (!pending) return;
    const payment = pending.payment
      ? await this.paymentModel.findById(pending.payment).lean()
      : null;
    const offerOpen =
      !!pending.expiresAt && pending.expiresAt.getTime() > now.getTime();
    if (payment?.status === PaymentStatus.SUCCEEDED) {
      throw new ConflictException(
        'The payment of an earlier change is being applied: try again in a moment',
      );
    }
    if (
      offerOpen &&
      payment &&
      (payment.status === PaymentStatus.PENDING ||
        payment.status === PaymentStatus.PROCESSING)
    ) {
      throw new ConflictException(
        `A change of this booking is awaiting payment until ${pending.expiresAt?.toISOString()}: pay it or wait for it to end`,
      );
    }
    if (payment && OPEN_PAYMENT_STATUSES.includes(payment.status)) {
      const stripe = this.paymentsService.stripe;
      if (stripe && payment.stripePaymentIntentId) {
        const cancelled = await this.paymentsService.cancelIntent(
          stripe,
          payment.stripePaymentIntentId,
        );
        if (!cancelled) {
          throw new ConflictException(
            'The earlier payment could not be cancelled yet: try again in a moment',
          );
        }
      }
      await this.paymentModel.updateOne(
        { _id: payment._id, status: { $in: OPEN_PAYMENT_STATUSES } },
        { $set: { status: PaymentStatus.CANCELLED } },
      );
    }
    await this.changeModel.updateOne(
      { _id: pending._id, status: FlightChangeStatus.PENDING_PAYMENT },
      {
        $set: {
          status: offerOpen
            ? FlightChangeStatus.SUPERSEDED
            : FlightChangeStatus.EXPIRED,
        },
      },
    );
  }

  private toQuote(draft: Draft): ChangeQuoteResponseDto {
    const booking = draft.booking;
    const difference = draft.differenceCents / 100;
    return {
      bookingId: booking._id.toString(),
      bookingReference: booking.bookingReference,
      currency: booking.currency,
      currentTotal: draft.oldTotalCents / 100,
      newTotal: draft.newTotalCents / 100,
      difference,
      outcome:
        draft.differenceCents > 0
          ? 'PAY_DIFFERENCE'
          : draft.differenceCents < 0
            ? 'REFUND_DIFFERENCE'
            : 'NO_DIFFERENCE',
      legs: draft.legs,
    };
  }

  private async notify(
    recipient: Types.ObjectId,
    type: NotificationType,
    title: string,
    message: string,
    relatedEntityId: Types.ObjectId,
  ): Promise<void> {
    try {
      await this.notificationsService.createNotification({
        recipient,
        type,
        title,
        message,
        relatedEntityType: 'FlightBooking',
        relatedEntityId,
      });
    } catch (error) {
      this.logger.error(
        `Could not create ${type} notification`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

/** The payments that hold the booking's money, newest first (the refund engine empties the newest first). */
export function paymentsNewestFirst(booking: {
  payment?: Types.ObjectId | null;
  changePayments?: Types.ObjectId[];
}): Types.ObjectId[] {
  const ids = [...(booking.changePayments ?? [])].reverse();
  if (booking.payment) ids.push(booking.payment);
  return ids;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}
