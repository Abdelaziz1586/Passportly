import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { NotificationType, ProviderType } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Airline, AirlineDocument } from '../flights/schemas/airline.schema';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ModeratorAssignment,
  ModeratorAssignmentDocument,
} from '../users/schemas/moderator-assignment.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ReactivateProviderResponseDto } from './dto/reactivate-provider-response.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) readonly userModel: Model<UserDocument>,
    @InjectModel(ModeratorAssignment.name)
    readonly moderatorAssignmentModel: Model<ModeratorAssignmentDocument>,
    @InjectModel(Airline.name) readonly airlineModel: Model<AirlineDocument>,
    @InjectModel(Hotel.name) readonly hotelModel: Model<HotelDocument>,
    readonly auditLogsService: AuditLogsService,
    readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Reactivates a deactivated Airline or Hotel provider, notifies its assigned
   * moderator(s), and records a PROVIDER_REACTIVATED AuditLog.
   */
  async reactivateProvider(
    rawType: string,
    providerId: string,
    admin: AuthenticatedUser,
    ipAddress?: string,
  ): Promise<ReactivateProviderResponseDto> {
    const providerType = this.parseProviderType(rawType);
    if (!isValidObjectId(providerId)) {
      throw new BadRequestException('Invalid provider ID');
    }

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

    if (provider.isActive) {
      throw new ConflictException(`${entityLabel} is already active`);
    }

    if (isAirline) {
      await this.airlineModel.findByIdAndUpdate(
        provider._id,
        {
          $set: { isActive: true },
          $unset: { deactivatedAt: 1, deactivatedBy: 1 },
        },
        { returnDocument: 'after' },
      );
    } else {
      await this.hotelModel.findByIdAndUpdate(
        provider._id,
        {
          $set: { isActive: true },
          $unset: { deactivatedAt: 1, deactivatedBy: 1 },
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

    await Promise.all(
      moderatorAssignments.map((assignment) =>
        this.notificationsService.createNotification({
          recipient: assignment.moderator,
          type: NotificationType.PROVIDER_REACTIVATED,
          title: `${entityLabel} Provider Reactivated`,
          message: `${provider.name} has been reactivated by an administrator and is now visible in search and open for bookings.`,
          relatedEntityType: entityLabel,
          relatedEntityId: provider._id,
        }),
      ),
    );

    await this.auditLogsService.log({
      actor: admin.userId,
      actorRole: admin.role,
      action: 'PROVIDER_REACTIVATED',
      targetType: entityLabel,
      targetId: String(provider._id),
      details: {
        providerType,
        providerName: provider.name,
        moderatorsNotified: moderatorAssignments.length,
      },
      ipAddress,
    });

    return {
      message: `${entityLabel} reactivated successfully`,
      id: String(provider._id),
      type: providerType,
      name: provider.name,
      isActive: true,
      moderatorsNotified: moderatorAssignments.length,
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
