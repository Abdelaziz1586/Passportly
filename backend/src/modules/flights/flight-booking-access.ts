import { NotFoundException } from '@nestjs/common';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { FlightBooking } from './schemas/flight-booking.schema';
import { Flight } from './schemas/flight.schema';

/** A booking as read for access checks and read-only views. */
export type LeanFlightBooking = FlightBooking & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Who may read a flight booking:
 * - the traveller who owns it (owner comes from the JWT user id),
 * - an admin,
 * - the airline moderator whose single assigned airline operates a flight of the booking.
 * Everyone else gets 404, exactly like a booking that does not exist.
 */
export async function loadReadableFlightBooking(
  user: AuthenticatedUser,
  id: string,
  bookingModel: Model<FlightBooking>,
  flightModel: Model<Flight>,
): Promise<LeanFlightBooking> {
  if (!isValidObjectId(id))
    throw new NotFoundException('Flight booking not found');
  const booking = (await bookingModel
    .findById(new Types.ObjectId(id))
    .lean()) as unknown as LeanFlightBooking | null;
  if (!booking) throw new NotFoundException('Flight booking not found');

  if (user.role === Role.ADMIN) return booking;

  if (user.role === Role.REGISTERED_USER) {
    if (isValidObjectId(user.userId) && booking.user.equals(user.userId)) {
      return booking;
    }
    throw new NotFoundException('Flight booking not found');
  }

  if (
    user.role === Role.AIRLINE_MODERATOR &&
    user.assignedProviderType === 'airline' &&
    user.assignedProviderId &&
    isValidObjectId(user.assignedProviderId)
  ) {
    const operated = await flightModel.exists({
      _id: { $in: booking.legs.map((leg) => leg.flight) },
      airline: new Types.ObjectId(user.assignedProviderId),
    });
    if (operated) return booking;
  }
  throw new NotFoundException('Flight booking not found');
}
