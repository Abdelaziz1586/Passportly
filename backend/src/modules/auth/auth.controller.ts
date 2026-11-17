import {
  Controller,
  Get,
  NotImplementedException,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuthService } from './auth.service';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'ACC-01: Register a new traveler account' })
  register() {
    throw new NotImplementedException(
      'POST /api/auth/register not implemented yet',
    );
  }

  @Public()
  @Get('verify-email')
  @ApiOperation({ summary: 'ACC-02 (Optional): Verify email address' })
  verifyEmail() {
    throw new NotImplementedException(
      'GET /api/auth/verify-email not implemented yet',
    );
  }

  @Public()
  @Post('login')
  @ApiOperation({
    summary: 'ACC-04, ACC-05: Login and issue httpOnly JWT cookie',
  })
  login() {
    throw new NotImplementedException(
      'POST /api/auth/login not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Post('logout')
  @ApiOperation({ summary: 'ACC-06: Logout and revoke current session' })
  logout(@CurrentUser() user: AuthenticatedUser) {
    throw new NotImplementedException(
      `POST /api/auth/logout not implemented yet (user: ${user.userId})`,
    );
  }

  @Public()
  @Post('forgot-password')
  @ApiOperation({ summary: 'ACC-07 (Optional): Request password reset' })
  forgotPassword() {
    throw new NotImplementedException(
      'POST /api/auth/forgot-password not implemented yet',
    );
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({ summary: 'ACC-07 (Optional): Reset password with token' })
  resetPassword() {
    throw new NotImplementedException(
      'POST /api/auth/reset-password not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Patch('change-password')
  @ApiOperation({ summary: 'ACC-08: Change current user password' })
  changePassword(@CurrentUser() user: AuthenticatedUser) {
    throw new NotImplementedException(
      `PATCH /api/auth/change-password not implemented yet (user: ${user.userId})`,
    );
  }

  @ApiCookieAuth()
  @Get('me')
  @ApiOperation({
    summary: 'ACC-04, ACC-19: Get authenticated session summary',
  })
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
