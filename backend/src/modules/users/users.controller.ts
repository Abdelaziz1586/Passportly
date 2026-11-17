import {
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Patch,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiCookieAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'ACC-11: Get current user profile' })
  getMyProfile(@CurrentUser() user: AuthenticatedUser) {
    throw new NotImplementedException(
      `GET /api/users/me not implemented yet (user: ${user.userId})`,
    );
  }

  @Patch('me')
  @ApiOperation({ summary: 'ACC-09: Update current user profile' })
  updateMyProfile(@CurrentUser() user: AuthenticatedUser) {
    throw new NotImplementedException(
      `PATCH /api/users/me not implemented yet (user: ${user.userId})`,
    );
  }

  @Delete('me')
  @ApiOperation({ summary: 'ACC-12: Deactivate current user account' })
  deactivateMyAccount(@CurrentUser() user: AuthenticatedUser) {
    throw new NotImplementedException(
      `DELETE /api/users/me not implemented yet (user: ${user.userId})`,
    );
  }
}
