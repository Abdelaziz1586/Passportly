import {
  Controller,
  Get,
  NotImplementedException,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { FlightsService } from './flights.service';

@ApiTags('Airlines')
@Controller('airlines')
export class AirlinesController {
  constructor(private readonly flightsService: FlightsService) {}

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Post()
  @ApiOperation({ summary: 'FLT-01: Create an airline profile' })
  createAirline() {
    throw new NotImplementedException('POST /api/airlines not implemented yet');
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'FLT-01: Get airline details' })
  getAirline() {
    throw new NotImplementedException(
      'GET /api/airlines/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Patch(':id')
  @ApiOperation({ summary: 'FLT-01: Update airline profile' })
  updateAirline() {
    throw new NotImplementedException(
      'PATCH /api/airlines/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Put(':id/baggage-policy')
  @ApiOperation({ summary: 'FLT-04, FLT-08: Set airline baggage policy' })
  updateBaggagePolicy() {
    throw new NotImplementedException(
      'PUT /api/airlines/:id/baggage-policy not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Put(':id/cancellation-policy')
  @ApiOperation({ summary: 'FLT-09: Set airline cancellation policy' })
  updateCancellationPolicy() {
    throw new NotImplementedException(
      'PUT /api/airlines/:id/cancellation-policy not implemented yet',
    );
  }
}
