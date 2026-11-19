import {
  NotImplementedException,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { FlightsService } from './flights.service';

@ApiTags('Flights')
@Controller('flights')
export class FlightsController {
  constructor(private readonly flightsService: FlightsService) {}

  @Public()
  @Get('search')
  @ApiOperation({
    summary: 'FLT-11, FLT-12, FLT-15: Search one-way & round-trip flights',
  })
  searchFlights() {
    throw new NotImplementedException(
      'GET /api/flights/search not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Post()
  @ApiOperation({ summary: 'FLT-03: Create a flight' })
  createFlight() {
    throw new NotImplementedException('POST /api/flights not implemented yet');
  }

  @Public()
  @Get(':id')
  getFlight(@Param('id') id: string) {
    return this.flightsService.getFlight(id);
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Patch(':id')
  @ApiOperation({ summary: 'FLT-05: Update flight schedule or details' })
  updateFlight() {
    throw new NotImplementedException(
      'PATCH /api/flights/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Post(':id/cancel')
  @ApiOperation({ summary: 'FLT-06: Cancel a flight' })
  cancelFlight() {
    throw new NotImplementedException(
      'POST /api/flights/:id/cancel not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Post(':id/cabins')
  @ApiOperation({ summary: 'FLT-04: Add cabin inventory to a flight' })
  addCabin() {
    throw new NotImplementedException(
      'POST /api/flights/:id/cabins not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Patch(':id/cabins/:cabinId')
  @ApiOperation({
    summary: 'FLT-04, FLT-05: Update cabin inventory or pricing',
  })
  updateCabin() {
    throw new NotImplementedException(
      'PATCH /api/flights/:id/cabins/:cabinId not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Get(':id/bookings')
  @ApiOperation({ summary: 'FLT-29: List bookings for a flight' })
  getFlightBookings() {
    throw new NotImplementedException(
      'GET /api/flights/:id/bookings not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Get(':id/passengers/export')
  @ApiOperation({ summary: 'FLT-29: Export passenger manifest for a flight' })
  exportPassengers() {
    throw new NotImplementedException(
      'GET /api/flights/:id/passengers/export not implemented yet',
    );
  }
}
