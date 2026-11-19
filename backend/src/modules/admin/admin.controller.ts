import {
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
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
import { DeactivateProviderResponseDto } from './dto/deactivate-provider-response.dto';

@ApiTags('Administration')
@ApiCookieAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('users/:id/reset-password')
  @ApiOperation({ summary: 'ACC-07a: Admin-assisted password reset' })
  resetUserPassword() {
    throw new NotImplementedException(
      'POST /api/admin/users/:id/reset-password not implemented yet',
    );
  }

  @Post('moderators')
  @ApiOperation({
    summary: 'ACC-13: Create airline or hotel moderator account & assignment',
  })
  createModerator() {
    throw new NotImplementedException(
      'POST /api/admin/moderators not implemented yet',
    );
  }

  @Get('accounts')
  @ApiOperation({ summary: 'ACC-14: List and filter platform accounts' })
  listAccounts() {
    throw new NotImplementedException(
      'GET /api/admin/accounts not implemented yet',
    );
  }

  @Patch('accounts/:id/suspend')
  @ApiOperation({
    summary: 'ACC-15, ACC-16: Suspend user or moderator account',
  })
  suspendAccount() {
    throw new NotImplementedException(
      'PATCH /api/admin/accounts/:id/suspend not implemented yet',
    );
  }

  @Patch('accounts/:id/reactivate')
  @ApiOperation({ summary: 'ACC-15, ACC-16: Reactivate suspended account' })
  reactivateAccount() {
    throw new NotImplementedException(
      'PATCH /api/admin/accounts/:id/reactivate not implemented yet',
    );
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
  reactivateProvider() {
    throw new NotImplementedException(
      'PATCH /api/admin/providers/:type/:id/reactivate not implemented yet',
    );
  }

  @Get('bookings')
  @ApiOperation({
    summary: 'ACC-17: Inspect all platform flight & hotel bookings',
  })
  listPlatformBookings() {
    throw new NotImplementedException(
      'GET /api/admin/bookings not implemented yet',
    );
  }

  @Get('reports')
  @ApiOperation({ summary: 'GEN-09, GEN-10: List submitted content reports' })
  listReports() {
    throw new NotImplementedException(
      'GET /api/admin/reports not implemented yet',
    );
  }

  @Patch('reports/:id')
  @ApiOperation({
    summary:
      'GEN-10: Resolve report (dismiss, hide content, or delete content)',
  })
  resolveReport() {
    throw new NotImplementedException(
      'PATCH /api/admin/reports/:id not implemented yet',
    );
  }

  @Delete('content/:type/:id')
  @ApiOperation({ summary: 'GEN-10: Delete inappropriate content directly' })
  deleteContent() {
    throw new NotImplementedException(
      'DELETE /api/admin/content/:type/:id not implemented yet',
    );
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'GEN-07: Query administrative audit logs' })
  listAuditLogs() {
    throw new NotImplementedException(
      'GET /api/admin/audit-logs not implemented yet',
    );
  }
}
