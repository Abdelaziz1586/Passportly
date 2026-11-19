import {
  NotImplementedException,
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
import { ManifestQuery } from './export-passengers.dto';

function csvCell(value: string | number | null | undefined) {
  const raw = String(value ?? '');
  const safe =
    typeof value === 'string' && /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(raw)
      ? "'" + raw
      : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
}

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
  @ApiOperation({ summary: 'FLT-17: Get flight details & cabin availability' })
  getFlight() {
    throw new NotImplementedException(
      'GET /api/flights/:id not implemented yet',
    );
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
