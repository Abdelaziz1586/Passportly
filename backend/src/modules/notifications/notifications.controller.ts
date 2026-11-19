import {
  Controller,
  Get,
  NotImplementedException,
  Patch,
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
import { MarkAllNotificationsReadResponseDto } from './dto/mark-all-read-response.dto';
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
  @ApiOperation({ summary: 'Mark a notification as read' })
  markAsRead() {
    throw new NotImplementedException(
      'PATCH /api/notifications/:id/read not implemented yet',
    );
  }
}
