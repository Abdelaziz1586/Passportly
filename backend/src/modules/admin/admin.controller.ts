import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ProviderType, Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AdminService } from './admin.service';
import {
  AdminResetPasswordDto,
  AdminResetPasswordResponseDto,
} from './dto/admin-reset-password.dto';
import {
  CreateModeratorDto,
  ModeratorResponseDto,
} from './dto/create-moderator.dto';
import {
  ListAccountsQueryDto,
  PaginatedAccountsResponseDto,
} from './dto/list-accounts-query.dto';
import {
  ListAdminBookingsQueryDto,
  PaginatedAdminBookingsResponseDto,
} from './dto/list-admin-bookings-query.dto';
import {
  ListReportsQueryDto,
  PaginatedReportsResponseDto,
} from './dto/list-reports-query.dto';
import { DeleteContentResponseDto } from './dto/delete-content-response.dto';
import {
  ResolveReportDto,
  ResolveReportResponseDto,
} from './dto/resolve-report.dto';
import { ReactivateAccountResponseDto } from './dto/reactivate-account-response.dto';
import { DeactivateProviderResponseDto } from './dto/deactivate-provider-response.dto';
import { ReactivateProviderResponseDto } from './dto/reactivate-provider-response.dto';
import {
  AccountStatusChangeResponseDto,
  SuspendAccountDto,
} from './dto/suspend-account.dto';

@ApiTags('Administration')
@ApiCookieAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('users/:id/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ACC-07a: Admin-assisted password reset' })
  @ApiParam({ name: 'id', type: String, description: 'Target user ID' })
  @ApiOkResponse({
    description: 'Temporary password set and active user sessions revoked',
    type: AdminResetPasswordResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid user ID, self-reset attempt, or weak temporary password',
  })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'User not found' })
  resetUserPassword(
    @Param('id') id: string,
    @Body() dto: AdminResetPasswordDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<AdminResetPasswordResponseDto> {
    return this.adminService.resetUserPassword(id, dto, admin, req.ip);
  }

  @Post('moderators')
  @ApiOperation({
    summary: 'ACC-13: Create airline or hotel moderator account & assignment',
  })
  @ApiCreatedResponse({
    description: 'Moderator account and provider assignment created',
    type: ModeratorResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid moderator payload, role, or providerId',
  })
  @ApiConflictResponse({
    description: 'Email already exists',
  })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Target Airline or Hotel not found' })
  createModerator(
    @Body() dto: CreateModeratorDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ModeratorResponseDto> {
    return this.adminService.createModerator(dto, admin, req.ip);
  }

  @Get('accounts')
  @ApiOperation({ summary: 'ACC-14: List and filter platform accounts' })
  @ApiOkResponse({
    description:
      'Paginated platform accounts with moderator provider assignment metadata',
    type: PaginatedAccountsResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid filter or pagination query' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  listAccounts(
    @Query() query: ListAccountsQueryDto,
  ): Promise<PaginatedAccountsResponseDto> {
    return this.adminService.listAccounts(query);
  }

  @Patch('accounts/:id/suspend')
  @ApiOperation({
    summary: 'ACC-15, ACC-16: Suspend user or moderator account',
  })
  @ApiParam({ name: 'id', type: String, description: 'Target account ID' })
  @ApiBody({ type: SuspendAccountDto, required: false })
  @ApiOkResponse({
    description: 'Account suspended and active sessions revoked',
    type: AccountStatusChangeResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid account ID or self-suspension attempt',
  })
  @ApiConflictResponse({ description: 'Account is already suspended' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Account not found' })
  suspendAccount(
    @Param('id') id: string,
    @Body() dto: SuspendAccountDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<AccountStatusChangeResponseDto> {
    return this.adminService.suspendAccount(id, dto, admin, req.ip);
  }

  @Patch('accounts/:id/reactivate')
  @ApiOperation({ summary: 'ACC-15, ACC-16: Reactivate suspended account' })
  @ApiParam({ name: 'id', type: String, description: 'Target account ID' })
  @ApiOkResponse({
    description: 'Account reactivated and lockout/suspension flags cleared',
    type: ReactivateAccountResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid account ID' })
  @ApiConflictResponse({ description: 'Account is already active' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Account not found' })
  reactivateAccount(
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ReactivateAccountResponseDto> {
    return this.adminService.reactivateAccount(id, admin, req.ip);
  }

  @Patch('providers/:type/:id/deactivate')
  @ApiOperation({
    summary: 'ACC-15: Deactivate airline or hotel provider (hides from search)',
  })
  @ApiParam({
    name: 'type',
    enum: ProviderType,
    description: 'Provider type (airline or hotel)',
  })
  @ApiParam({ name: 'id', type: String, description: 'Provider ID' })
  @ApiOkResponse({
    description:
      'Provider deactivated while keeping existing confirmed bookings valid',
    type: DeactivateProviderResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid provider type or provider ID',
  })
  @ApiConflictResponse({ description: 'Provider is already deactivated' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Provider not found' })
  deactivateProvider(
    @Param('type') type: string,
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<DeactivateProviderResponseDto> {
    return this.adminService.deactivateProvider(type, id, admin, req.ip);
  }

  @Patch('providers/:type/:id/reactivate')
  @ApiOperation({ summary: 'ACC-15: Reactivate airline or hotel provider' })
  @ApiParam({
    name: 'type',
    enum: ProviderType,
    description: 'Provider type (airline or hotel)',
  })
  @ApiParam({ name: 'id', type: String, description: 'Provider ID' })
  @ApiOkResponse({
    description: 'Provider reactivated and assigned moderator notified',
    type: ReactivateProviderResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid provider type or provider ID',
  })
  @ApiConflictResponse({ description: 'Provider is already active' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Provider not found' })
  reactivateProvider(
    @Param('type') type: string,
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ReactivateProviderResponseDto> {
    return this.adminService.reactivateProvider(type, id, admin, req.ip);
  }

  @Get('bookings')
  @ApiOperation({
    summary: 'ACC-17: Inspect all platform flight & hotel bookings',
  })
  @ApiOkResponse({
    description: 'Paginated platform flight and/or hotel bookings',
    type: PaginatedAdminBookingsResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid filter or date range query' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  listPlatformBookings(
    @Query() query: ListAdminBookingsQueryDto,
  ): Promise<PaginatedAdminBookingsResponseDto> {
    return this.adminService.listPlatformBookings(query);
  }

  @Get('reports')
  @ApiOperation({ summary: 'GEN-09, GEN-10: List submitted content reports' })
  @ApiOkResponse({
    description: 'Paginated content moderation reports with reporter details',
    type: PaginatedReportsResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid filter or pagination query' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  listReports(
    @Query() query: ListReportsQueryDto,
  ): Promise<PaginatedReportsResponseDto> {
    return this.adminService.listReports(query);
  }

  @Patch('reports/:id')
  @ApiOperation({
    summary:
      'GEN-10: Resolve report (dismiss, hide content, or delete content)',
  })
  @ApiParam({ name: 'id', type: String, description: 'Report ID' })
  @ApiOkResponse({
    description: 'Report resolved and moderation action applied',
    type: ResolveReportResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid report ID or resolution body',
  })
  @ApiConflictResponse({ description: 'Report has already been resolved' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Report or target content not found' })
  resolveReport(
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ResolveReportResponseDto> {
    return this.adminService.resolveReport(id, dto, admin, req.ip);
  }

  @Delete('content/:type/:id')
  @ApiOperation({ summary: 'GEN-10: Delete inappropriate content directly' })
  @ApiParam({
    name: 'type',
    enum: ['blog_post', 'comment', 'itinerary', 'review'],
    description: 'Target content type',
  })
  @ApiParam({ name: 'id', type: String, description: 'Target content ID' })
  @ApiOkResponse({
    description: 'Content deleted, owner notified, and audit logged',
    type: DeleteContentResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid content type or content ID' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Target content not found' })
  deleteContent(
    @Param('type') type: string,
    @Param('id') id: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<DeleteContentResponseDto> {
    return this.adminService.deleteContent(type, id, admin, req.ip);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'GEN-07: Query administrative audit logs' })
  listAuditLogs() {
    throw new NotImplementedException(
      'GET /api/admin/audit-logs not implemented yet',
    );
  }
}
