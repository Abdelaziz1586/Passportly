import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { FlightsService } from './flights.service';
import {
  CabinCreate,
  CabinUpdate,
  FlightCreate,
  FlightUpdate,
} from './create-flight.dto';
import { FlightCancel } from './cancel-flight.dto';
import { BookingsQuery } from './flight-bookings-list.dto';
import { ManifestQuery } from './export-passengers.dto';

function csvCell(value: string | number | null | undefined) {
  const raw = String(value ?? '');
  const safe =
    typeof value === 'string' && /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(raw)
      ? "'" + raw
      : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
}
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
  updateFlight(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: FlightUpdate,
  ) {
    return this.flightsService.updateFlight(id, user, input);
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Post(':id/cancel')
  @ApiOperation({ summary: 'FLT-06: Cancel a flight' })
  cancelFlight(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: FlightCancel,
  ) {
    return this.flightsService.cancelFlight(id, user, input);
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Post(':id/cabins')
  @ApiOperation({ summary: 'FLT-04: Add cabin inventory to a flight' })
  addCabin(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CabinCreate,
  ) {
    return this.flightsService.addCabin(id, user, input);
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Patch(':id/cabins/:cabinId')
  @ApiOperation({
    summary: 'FLT-04, FLT-05: Update cabin inventory or pricing',
  })
  updateCabin(
    @Param('id') id: string,
    @Param('cabinId') cabinId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CabinUpdate,
  ) {
    return this.flightsService.updateCabin(id, cabinId, user, input);
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Get(':id/bookings')
  @ApiOperation({ summary: 'FLT-29: List bookings for a flight' })
  getFlightBookings(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: BookingsQuery,
  ) {
    return this.flightsService.getFlightBookings(id, user, query);
  }

  @ApiCookieAuth()
  @Roles(Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Get(':id/passengers/export')
  @ApiOperation({ summary: 'FLT-29: Export passenger manifest for a flight' })
  async exportPassengers(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ManifestQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    const rows = await this.flightsService.manifest(id, user);
    response.setHeader('Cache-Control', 'no-store');
    if (query.format === 'json') return rows;
    response.attachment('passenger-manifest.csv');
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return (
      [
        'name,type,cabin,seat,eTicketReference,extraBaggageCount,bookingReference',
        ...rows.map((row) => Object.values(row).map(csvCell).join(',')),
      ].join('\r\n') + '\r\n'
    );
  }
}
