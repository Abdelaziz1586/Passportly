import {
  Controller,
  Get,
  NotImplementedException,
  Param,
  Patch,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { NotificationItemDto } from './dto/notification-response.dto';
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

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllAsRead() {
    throw new NotImplementedException(
      'PATCH /api/notifications/read-all not implemented yet',
    );
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'GEN-11: Mark a notification as read' })
  @ApiParam({ name: 'id', type: String, description: 'Notification ID' })
  @ApiOkResponse({
    description: 'Notification marked as read',
    type: NotificationItemDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid notification ID' })
  @ApiForbiddenResponse({
    description: 'Notification belongs to another user',
  })
  @ApiNotFoundResponse({ description: 'Notification not found' })
  markAsRead(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationItemDto> {
    return this.notificationsService.markAsRead(id, user.userId);
  }
}
