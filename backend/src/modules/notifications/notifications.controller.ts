import {
  Controller,
  Get,
  NotImplementedException,
  Patch,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiCookieAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List current user in-app notifications' })
  listMine() {
    throw new NotImplementedException(
      'GET /api/notifications not implemented yet',
    );
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  markAsRead() {
    throw new NotImplementedException(
      'PATCH /api/notifications/:id/read not implemented yet',
    );
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllAsRead() {
    throw new NotImplementedException(
      'PATCH /api/notifications/read-all not implemented yet',
    );
  }
}
