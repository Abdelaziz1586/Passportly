import { Controller, NotImplementedException, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiCookieAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @ApiOperation({ summary: 'GEN-09: Report inappropriate content' })
  createReport() {
    throw new NotImplementedException('POST /api/reports not implemented yet');
  }
}
