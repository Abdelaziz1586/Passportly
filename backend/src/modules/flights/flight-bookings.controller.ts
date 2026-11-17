import {
  Controller,
  Get,
  NotImplementedException,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { FlightsService } from './flights.service';

@ApiTags('Flight Bookings')
@ApiCookieAuth()
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(private readonly flightsService: FlightsService) {}

  @Roles(Role.REGISTERED_USER)
  @Post('hold')
  @ApiOperation({
    summary: 'FLT-22: Place concurrency-safe temporary seat hold',
  })
  holdSeats() {
    throw new NotImplementedException(
      'POST /api/flight-bookings/hold not implemented yet',
    );
  }

  @Roles(Role.REGISTERED_USER)
  @Post()
  @ApiOperation({
    summary:
      'FLT-19, FLT-21: Create flight booking with passenger & baggage details',
  })
  createBooking() {
    throw new NotImplementedException(
      'POST /api/flight-bookings not implemented yet',
    );
  }

  @Roles(Role.REGISTERED_USER, Role.ADMIN)
  @Get()
  @ApiOperation({ summary: 'FLT-25: List current user flight bookings' })
  listBookings() {
    throw new NotImplementedException(
      'GET /api/flight-bookings not implemented yet',
    );
  }

  @Roles(Role.REGISTERED_USER, Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Get(':id')
  @ApiOperation({ summary: 'FLT-25: Get flight booking details' })
  getBooking() {
    throw new NotImplementedException(
      'GET /api/flight-bookings/:id not implemented yet',
    );
  }

  @Roles(Role.REGISTERED_USER)
  @Post(':id/cancel')
  @ApiOperation({
    summary: 'FLT-26: Cancel flight booking according to airline policy',
  })
  cancelBooking() {
    throw new NotImplementedException(
      'POST /api/flight-bookings/:id/cancel not implemented yet',
    );
  }

  @Roles(Role.REGISTERED_USER)
  @Patch(':id/change-flight')
  @ApiOperation({ summary: 'FLT-27 (Optional): Change flight on a booking' })
  changeFlight() {
    throw new NotImplementedException(
      'PATCH /api/flight-bookings/:id/change-flight not implemented yet',
    );
  }

  @Roles(Role.REGISTERED_USER, Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Get(':id/e-ticket')
  @ApiOperation({
    summary: 'FLT-23: Retrieve generated e-ticket for confirmed booking',
  })
  getETicket() {
    throw new NotImplementedException(
      'GET /api/flight-bookings/:id/e-ticket not implemented yet',
    );
  }

  @Roles(Role.REGISTERED_USER)
  @Patch(':id/seat')
  @ApiOperation({ summary: 'FLT-28 (Optional): Select or change seat' })
  selectSeat() {
    throw new NotImplementedException(
      'PATCH /api/flight-bookings/:id/seat not implemented yet',
    );
  }
}
