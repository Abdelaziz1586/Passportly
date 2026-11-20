import {
  NotImplementedException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { FlightsService } from './flights.service';
import { FlightCreate } from './create-flight.dto';
import { FlightSearch } from './flight-search.dto';

@ApiTags('Flights')
@Controller('flights')
export class FlightsController {
  constructor(private readonly flightsService: FlightsService) {}

  @Public()
  @Get('search')
  @ApiOperation({
    summary: 'FLT-11, FLT-12, FLT-15: Search one-way & round-trip flights',
  })
  searchFlights(@Query() query: FlightSearch) {
    return this.flightsService.searchFlights(query);
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Post()
  @ApiOperation({ summary: 'FLT-03: Create a flight' })
  createFlight(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: FlightCreate,
  ) {
    return this.flightsService.createFlight(user, input);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'FLT-17: Get flight details & cabin availability' })
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
