import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import {
  BookingStatus,
  NotificationType,
  ProviderType,
} from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Airline, AirlineDocument } from '../flights/schemas/airline.schema';
import {
  FlightBooking,
  FlightBookingDocument,
} from '../flights/schemas/flight-booking.schema';
import { Flight, FlightDocument } from '../flights/schemas/flight.schema';
import {
  HotelBooking,
  HotelBookingDocument,
} from '../hotels/schemas/hotel-booking.schema';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ModeratorAssignment,
  ModeratorAssignmentDocument,
} from '../users/schemas/moderator-assignment.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { DeactivateProviderResponseDto } from './dto/deactivate-provider-response.dto';

type AffectedBooking = {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  bookingReference: string;
  status: BookingStatus;
};

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) readonly userModel: Model<UserDocument>,
    @InjectModel(ModeratorAssignment.name)
    readonly moderatorAssignmentModel: Model<ModeratorAssignmentDocument>,
    @InjectModel(Airline.name) readonly airlineModel: Model<AirlineDocument>,
    @InjectModel(Flight.name) readonly flightModel: Model<FlightDocument>,
    @InjectModel(FlightBooking.name)
    readonly flightBookingModel: Model<FlightBookingDocument>,
    @InjectModel(Hotel.name) readonly hotelModel: Model<HotelDocument>,
    @InjectModel(HotelBooking.name)
    readonly hotelBookingModel: Model<HotelBookingDocument>,
    readonly auditLogsService: AuditLogsService,
    readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Deactivates an Airline or Hotel provider (hiding it from search and new
   * bookings while preserving existing CONFIRMED bookings), notifies assigned
   * moderators and travelers with active bookings, and records an AuditLog.
   */
  async deactivateProvider(
    rawType: string,
    providerId: string,
    admin: AuthenticatedUser,
    ipAddress?: string,
  ): Promise<DeactivateProviderResponseDto> {
    const providerType = this.parseProviderType(rawType);
    if (!isValidObjectId(providerId)) {
      throw new BadRequestException('Invalid provider ID');
    }

    const now = new Date();
    const adminObjectId = new Types.ObjectId(admin.userId);
    const isAirline = providerType === ProviderType.AIRLINE;
    const entityLabel = isAirline ? 'Airline' : 'Hotel';

    const provider = isAirline
      ? await this.airlineModel
          .findById(providerId)
          .select('_id name isActive')
          .lean()
      : await this.hotelModel
          .findById(providerId)
          .select('_id name isActive')
          .lean();

    if (!provider) {
      throw new NotFoundException(`${entityLabel} not found`);
    }

    if (!provider.isActive) {
      throw new ConflictException(`${entityLabel} is already deactivated`);
    }

    if (isAirline) {
      await this.airlineModel.findByIdAndUpdate(
        provider._id,
        {
          $set: {
            isActive: false,
            deactivatedAt: now,
            deactivatedBy: adminObjectId,
          },
        },
        { returnDocument: 'after' },
      );
    } else {
      await this.hotelModel.findByIdAndUpdate(
        provider._id,
        {
          $set: {
            isActive: false,
            deactivatedAt: now,
            deactivatedBy: adminObjectId,
          },
        },
        { returnDocument: 'after' },
      );
    }

    const assignmentFilter = isAirline
      ? {
          providerType: ProviderType.AIRLINE,
          airline: provider._id,
          isActive: true,
        }
      : {
          providerType: ProviderType.HOTEL,
          hotel: provider._id,
          isActive: true,
        };

    const moderatorAssignments = await this.moderatorAssignmentModel
      .find(assignmentFilter)
      .select('moderator')
      .lean();

    const activeStatuses = [
      BookingStatus.CONFIRMED,
      BookingStatus.HELD,
      BookingStatus.PENDING_PAYMENT,
    ];

    let affectedBookings: AffectedBooking[] = [];
    if (isAirline) {
      const flightIds = await this.flightModel.distinct('_id', {
        airline: provider._id,
      });
      if (flightIds.length > 0) {
        affectedBookings = await this.flightBookingModel
          .find({
            'legs.flight': { $in: flightIds },
            status: { $in: activeStatuses },
          })
          .select('_id user bookingReference status')
          .lean<AffectedBooking[]>();
      }
    } else {
      affectedBookings = await this.hotelBookingModel
        .find({
          hotel: provider._id,
          status: { $in: activeStatuses },
        })
        .select('_id user bookingReference status')
        .lean<AffectedBooking[]>();
    }

    await Promise.all(
      moderatorAssignments.map((assignment) =>
        this.notificationsService.createNotification({
          recipient: assignment.moderator,
          type: NotificationType.PROVIDER_DEACTIVATED,
          title: `${entityLabel} Provider Deactivated`,
          message: `${provider.name} has been deactivated by an administrator and hidden from public search and new bookings. Existing confirmed bookings remain valid.`,
          relatedEntityType: entityLabel,
          relatedEntityId: provider._id,
        }),
      ),
    );

    const bookingEntityType = isAirline ? 'FlightBooking' : 'HotelBooking';
    const notifiedTravelerIds = new Set<string>();
    await Promise.all(
      affectedBookings.map((booking) => {
        notifiedTravelerIds.add(String(booking.user));
        const statusNotice =
          booking.status === BookingStatus.CONFIRMED
            ? 'Your existing confirmed booking remains valid.'
            : 'Please review your booking status or contact support if needed.';
        return this.notificationsService.createNotification({
          recipient: booking.user,
          type: NotificationType.PROVIDER_DEACTIVATED,
          title: `${entityLabel} Deactivated Notice`,
          message: `${provider.name} has been deactivated for new bookings (Booking ${booking.bookingReference}). ${statusNotice}`,
          relatedEntityType: bookingEntityType,
          relatedEntityId: booking._id,
        });
      }),
    );

    await this.auditLogsService.log({
      actor: admin.userId,
      actorRole: admin.role,
      action: 'PROVIDER_DEACTIVATED',
      targetType: entityLabel,
      targetId: String(provider._id),
      details: {
        providerType,
        providerName: provider.name,
        moderatorsNotified: moderatorAssignments.length,
        bookingsNotifiedCount: affectedBookings.length,
        travelersNotified: notifiedTravelerIds.size,
      },
      ipAddress,
    });

    return {
      message: `${entityLabel} deactivated successfully`,
      id: String(provider._id),
      type: providerType,
      name: provider.name,
      isActive: false,
      deactivatedAt: now,
      moderatorsNotified: moderatorAssignments.length,
      travelersNotified: notifiedTravelerIds.size,
    };
  }

  private parseProviderType(rawType: string): ProviderType {
    const normalized = rawType.trim().toLowerCase();
    if (
      normalized !== (ProviderType.AIRLINE as string) &&
      normalized !== (ProviderType.HOTEL as string)
    ) {
      throw new BadRequestException(
        'Provider type must be either airline or hotel',
      );
    }
    return normalized as ProviderType;
  }
}
