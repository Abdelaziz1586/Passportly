import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { NotificationType } from '../../common/enums';
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
    const notification = new this.notificationModel({
      recipient: new Types.ObjectId(params.recipient),
      type: params.type,
      title: params.title,
      message: params.message,
      relatedEntityType: params.relatedEntityType,
      relatedEntityId: params.relatedEntityId
        ? new Types.ObjectId(params.relatedEntityId)
        : undefined,
    });
    return notification.save({ session });
  }
}
