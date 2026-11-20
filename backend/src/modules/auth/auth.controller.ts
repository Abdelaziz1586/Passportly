import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuthService } from './auth.service';
import { ChangePasswordResponseDto } from './dto/change-password-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordResponseDto } from './dto/forgot-password-response.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutResponseDto } from './dto/logout-response.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordResponseDto } from './dto/reset-password-response.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SafeUserResponseDto } from './dto/safe-user-response.dto';
import { VerifyEmailQueryDto } from './dto/verify-email-query.dto';
import { VerifyEmailResponseDto } from './dto/verify-email-response.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'ACC-01: Register a new traveler account' })
  @ApiCreatedResponse({
    description: 'Traveler account registered successfully',
    type: SafeUserResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid registration payload or weak password',
  })
  @ApiConflictResponse({
    description: 'An account with this email already exists',
  })
  register(@Body() dto: RegisterDto): Promise<SafeUserResponseDto> {
    return this.authService.register(dto);
  }

  @Public()
  @Get('verify-email')
  @ApiOperation({ summary: 'ACC-02 (Optional): Verify email address' })
  @ApiOkResponse({
    description: 'Email address verified successfully',
    type: VerifyEmailResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Missing, invalid, or expired email verification token',
  })
  verifyEmail(
    @Query() query: VerifyEmailQueryDto,
  ): Promise<VerifyEmailResponseDto> {
    return this.authService.verifyEmail(query);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ACC-04, ACC-05: Login and issue httpOnly JWT cookie',
  })
  @ApiOkResponse({
    description: 'Login successful; httpOnly JWT cookie set',
    type: LoginResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid email or password',
  })
  @ApiForbiddenResponse({
    description:
      'Account is suspended, deactivated, or temporarily locked due to failed attempts',
  })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.authService.login(dto, {
      userAgent: req.get('user-agent'),
      ipAddress: req.ip,
    });
    res.cookie(result.cookieName, result.accessToken, result.cookieOptions);
    return result.response;
  }

  @ApiCookieAuth()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ACC-06: Logout and revoke current session' })
  @ApiOkResponse({
    description: 'Session revoked and httpOnly auth cookie cleared',
    type: LogoutResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
  })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResponseDto> {
    const result = await this.authService.logout(user);
    res.clearCookie(result.cookieName, result.clearCookieOptions);
    return result.response;
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ACC-07 (Optional): Request password reset' })
  @ApiOkResponse({
    description:
      'Password reset request accepted (generic message returned without leaking account existence)',
    type: ForgotPasswordResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid email format',
  })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<ForgotPasswordResponseDto> {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ACC-07 (Optional): Reset password with token' })
  @ApiOkResponse({
    description: 'Password reset successfully and existing sessions revoked',
    type: ResetPasswordResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Missing, invalid, or expired reset token, or weak new password',
  })
  resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<ResetPasswordResponseDto> {
    return this.authService.resetPassword(dto);
  }

  @ApiCookieAuth()
  @Patch('change-password')
  @ApiOperation({ summary: 'ACC-08: Change current user password' })
  @ApiOkResponse({
    description:
      'Password changed successfully and mustChangePassword flag cleared',
    type: ChangePasswordResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid payload, weak password, or new password matches current password',
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required or current password is incorrect',
  })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<ChangePasswordResponseDto> {
    return this.authService.changePassword(user, dto);
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
