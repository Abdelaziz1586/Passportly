import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
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
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { MarkAllNotificationsReadResponseDto } from './dto/mark-all-read-response.dto';
import {
  NotificationItemDto,
  PaginatedNotificationsResponseDto,
} from './dto/notification-response.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiCookieAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'GEN-11: List current user in-app notifications',
  })
  @ApiOkResponse({
    description: 'Paginated notifications and unread count for current user',
    type: PaginatedNotificationsResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid query parameters',
  })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<PaginatedNotificationsResponseDto> {
    return this.notificationsService.listMyNotifications(user.userId, query);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'GEN-11: Mark all user notifications as read' })
  @ApiOkResponse({
    description: 'All unread notifications marked as read',
    type: MarkAllNotificationsReadResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid user ID' })
  markAllAsRead(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MarkAllNotificationsReadResponseDto> {
    return this.notificationsService.markAllAsRead(user.userId);
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
