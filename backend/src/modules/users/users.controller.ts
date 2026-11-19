import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  Patch,
  Res,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { DeactivateAccountResponseDto } from './dto/deactivate-account-response.dto';
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

  @Roles(Role.REGISTERED_USER)
  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ACC-12: Deactivate current user account' })
  @ApiOkResponse({
    description:
      'Account deactivated, active sessions revoked, and httpOnly auth cookie cleared',
    type: DeactivateAccountResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({
    description: 'Only registered traveler accounts can self-deactivate',
  })
  @ApiNotFoundResponse({ description: 'User account not found' })
  async deactivateMyAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DeactivateAccountResponseDto> {
    const result = await this.usersService.deactivateMyAccount(user);
    res.clearCookie(result.cookieName, result.clearCookieOptions);
    return result.response;
  }
}
