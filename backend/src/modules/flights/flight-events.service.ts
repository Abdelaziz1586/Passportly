import { Injectable } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import { NotificationType } from '../../common/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { FlightBookingDocument } from './schemas/flight-booking.schema';
import { FlightDocument } from './schemas/flight.schema';

@Injectable()
export class FlightEventsService {
  constructor(private readonly notifications: NotificationsService) {}

  async notify(
    booking: FlightBookingDocument,
    flight: FlightDocument,
    type: NotificationType,
    session: ClientSession,
  ) {
    const title =
      type === NotificationType.FLIGHT_CANCELLED
        ? 'Flight cancelled'
        : 'Flight schedule changed';
    await this.notifications.createNotification(
      {
        recipient: booking.user,
        type,
        title,
        message: flight.flightNumber + ': ' + title,
        relatedEntityType: 'flight',
        relatedEntityId: flight._id,
      },
      session,
    );
  }
}
