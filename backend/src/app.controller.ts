import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';
import { AppService } from './app.service';

@ApiTags('Health')
@Public()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @ApiOperation({ summary: 'API health check' })
  getHealth() {
    return {
      status: 'ok',
      service: 'travel-platform-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
