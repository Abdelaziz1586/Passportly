import {
  Controller,
  Get,
  NotImplementedException,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { PaginatedNotificationsResponseDto } from './dto/notification-response.dto';
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
