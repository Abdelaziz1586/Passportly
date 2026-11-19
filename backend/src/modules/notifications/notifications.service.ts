import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { NotificationType } from '../../common/enums';
import { NotificationItemDto } from './dto/notification-response.dto';
import {
  Notification,
  NotificationDocument,
} from './schemas/notification.schema';

type LeanNotification = {
  _id: Types.ObjectId;
  recipient: Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  relatedEntityType?: string;
  relatedEntityId?: Types.ObjectId;
  isRead: boolean;
  readAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};

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
   * Verifies ownership of a single notification and marks it as read.
   */
  async markAsRead(
    notificationId: string,
    userId: string,
  ): Promise<NotificationItemDto> {
    if (!isValidObjectId(notificationId)) {
      throw new BadRequestException('Invalid notification ID');
    }
    if (!isValidObjectId(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const existing = await this.notificationModel
      .findById(notificationId)
      .lean<LeanNotification | null>();

    if (!existing) {
      throw new NotFoundException('Notification not found');
    }

    if (String(existing.recipient) !== userId) {
      throw new ForbiddenException(
        'You can only mark your own notifications as read',
      );
    }

    if (existing.isRead) {
      return this.toNotificationDto(existing);
    }

    const updated = await this.notificationModel
      .findOneAndUpdate(
        {
          _id: existing._id,
          recipient: existing.recipient,
          isRead: false,
        },
        {
          $set: {
            isRead: true,
            readAt: new Date(),
          },
        },
        { returnDocument: 'after' },
      )
      .lean<LeanNotification | null>();

    const finalDoc =
      updated ??
      (await this.notificationModel
        .findById(existing._id)
        .lean<LeanNotification | null>());

    if (!finalDoc) {
      throw new NotFoundException('Notification not found');
    }

    return this.toNotificationDto(finalDoc);
  }

  private toNotificationDto(doc: LeanNotification): NotificationItemDto {
    return {
      id: String(doc._id),
      recipient: String(doc.recipient),
      type: doc.type,
      title: doc.title,
      message: doc.message,
      ...(doc.relatedEntityType !== undefined
        ? { relatedEntityType: doc.relatedEntityType }
        : {}),
      ...(doc.relatedEntityId !== undefined
        ? { relatedEntityId: String(doc.relatedEntityId) }
        : {}),
      isRead: doc.isRead,
      ...(doc.readAt !== undefined ? { readAt: doc.readAt } : {}),
      ...(doc.createdAt !== undefined ? { createdAt: doc.createdAt } : {}),
      ...(doc.updatedAt !== undefined ? { updatedAt: doc.updatedAt } : {}),
    };
  }
}
