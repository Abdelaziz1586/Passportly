import {
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Patch,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { UserProfileResponseDto } from './dto/user-profile-response.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiCookieAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'ACC-11: Get current user profile' })
  @ApiOkResponse({
    description:
      'Sanitized user profile (plus active moderator assignment when applicable)',
    type: UserProfileResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiNotFoundResponse({ description: 'User account not found' })
  getMyProfile(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserProfileResponseDto> {
    return this.usersService.getMyProfile(user);
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
