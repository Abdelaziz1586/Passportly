import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { NotificationType } from '../../common/enums';
import { MarkAllNotificationsReadResponseDto } from './dto/mark-all-read-response.dto';
import {
  Notification,
  NotificationDocument,
} from './schemas/notification.schema';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    readonly notificationModel: Model<NotificationDocument>,
  ) {}

  async createNotification(params: {
    recipient: string | Types.ObjectId;
    type: NotificationType;
    title: string;
    message: string;
    relatedEntityType?: string;
    relatedEntityId?: string | Types.ObjectId;
  }) {
    return this.notificationModel.create({
      recipient: new Types.ObjectId(params.recipient),
      type: params.type,
      title: params.title,
      message: params.message,
      relatedEntityType: params.relatedEntityType,
      relatedEntityId: params.relatedEntityId
        ? new Types.ObjectId(params.relatedEntityId)
        : undefined,
    });
  }

  /**
   * Marks all unread notifications belonging to the authenticated user as read.
   */
  async markAllAsRead(
    userId: string,
  ): Promise<MarkAllNotificationsReadResponseDto> {
    if (!isValidObjectId(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const readAt = new Date();
    const result = await this.notificationModel.updateMany(
      {
        recipient: new Types.ObjectId(userId),
        isRead: false,
      },
      {
        $set: {
          isRead: true,
          readAt,
        },
      },
    );

    return {
      message: 'All unread notifications marked as read',
      modifiedCount: result.modifiedCount ?? 0,
      readAt,
    };
  }
}
