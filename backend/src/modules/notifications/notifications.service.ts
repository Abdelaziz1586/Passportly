import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, isValidObjectId, Model, Types } from 'mongoose';
import { NotificationType } from '../../common/enums';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { MarkAllNotificationsReadResponseDto } from './dto/mark-all-read-response.dto';
import {
  NotificationItemDto,
  PaginatedNotificationsResponseDto,
} from './dto/notification-response.dto';
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

  async createNotification(
    params: {
      recipient: string | Types.ObjectId;
      type: NotificationType;
      title: string;
      message: string;
      relatedEntityType?: string;
      relatedEntityId?: string | Types.ObjectId;
    },
    session?: ClientSession,
  ) {
    const payload = {
      recipient: new Types.ObjectId(params.recipient),
      type: params.type,
      title: params.title,
      message: params.message,
      relatedEntityType: params.relatedEntityType,
      relatedEntityId: params.relatedEntityId
        ? new Types.ObjectId(params.relatedEntityId)
        : undefined,
    };
    if (session) {
      const [created] = await this.notificationModel.create([payload], {
        session,
      });
      return created;
    }
    return this.notificationModel.create(payload);
  }

  /**
   * Lists paginated in-app notifications for the authenticated user along with
   * their total unread count and optional unread-only / type filters.
   */
  async listMyNotifications(
    userId: string,
    query: ListNotificationsQueryDto,
  ): Promise<PaginatedNotificationsResponseDto> {
    if (!isValidObjectId(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const recipientId = new Types.ObjectId(userId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortDirection = query.sortOrder === 'asc' ? 1 : -1;

    const filter: Record<string, unknown> = { recipient: recipientId };
    if (query.unreadOnly === true) {
      filter.isRead = false;
    }
    if (query.type) {
      filter.type = query.type;
    }

    const [items, total, unreadCount] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ [sortBy]: sortDirection, _id: sortDirection })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanNotification[]>(),
      this.notificationModel.countDocuments(filter),
      this.notificationModel.countDocuments({
        recipient: recipientId,
        isRead: false,
      }),
    ]);

    return {
      data: items.map((item) => this.toNotificationDto(item)),
      unreadCount,
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
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
