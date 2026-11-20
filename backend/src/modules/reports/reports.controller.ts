import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportResponseDto } from './dto/report-response.dto';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiCookieAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @ApiOperation({ summary: 'GEN-09: Report inappropriate content' })
  @ApiCreatedResponse({
    description: 'Content report created with status PENDING',
    type: ReportResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid report payload' })
  @ApiNotFoundResponse({ description: 'Reported content target not found' })
  @ApiConflictResponse({
    description: 'Duplicate pending report already exists for this content',
  })
  createReport(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReportDto,
  ): Promise<ReportResponseDto> {
    return this.reportsService.createReport(user, dto);
  }
}
