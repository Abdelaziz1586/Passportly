import {
  Body,
  Controller,
  Get,
  NotImplementedException,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CreateFlightBookingDto } from './dto/create-flight-booking.dto';
import { HoldSeatsDto } from './dto/hold-seats.dto';
import {
  FlightBookingResponse,
  FlightBookingsService,
  FlightHoldResponse,
} from './flight-bookings.service';

@ApiTags('Flight Bookings')
@ApiCookieAuth()
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(private readonly flightBookingsService: FlightBookingsService) {}

  @Roles(Role.REGISTERED_USER)
  @Post('hold')
  @ApiOperation({
    summary: 'FLT-22: Place concurrency-safe temporary seat hold',
    description:
      'Reserves seats on every leg and creates a HELD booking that expires 10 minutes after creation (the hold is never extended; payment can be retried until it expires). Infants (under 2) take no seat and pay 10% of the cabin fare per leg. There is no passenger cap: availability decides, and a 409 means not enough seats.',
  })
  @ApiCreatedResponse({ description: 'Seats held; booking is in HELD status' })
  @ApiBadRequestResponse({ description: 'Invalid passengers, legs or trip' })
  @ApiNotFoundResponse({ description: 'Flight or cabin not found' })
  @ApiConflictResponse({
    description: 'Not enough seats, or the flight/airline cannot be booked',
  })
  holdSeats(
    @Body() dto: HoldSeatsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FlightHoldResponse> {
    return this.flightBookingsService.holdSeats(user.userId, dto);
  }

  @Roles(Role.REGISTERED_USER)
  @Post()
  @ApiOperation({
    summary:
      'FLT-19, FLT-21: Create flight booking with passenger & baggage details',
    description:
      'Takes the HELD booking from /flight-bookings/hold plus one entry per traveller, prices extra baggage, snapshots the airline policies and moves the booking to PENDING_PAYMENT. It is never CONFIRMED here: only a verified payment confirms it. The hold is not extended, so pay before holdExpiresAt. Passenger types must match the age on the outbound departure date (Adult 12+, Child 2-11, Infant under 2), and the passenger counts must equal the hold.',
  })
  @ApiCreatedResponse({
    description:
      'Booking is PENDING_PAYMENT with totals, passengers and the policies to accept',
  })
  @ApiBadRequestResponse({
    description:
      'Invalid body, or passengers do not match the held adults/children/infants',
  })
  @ApiUnauthorizedResponse({ description: 'Not signed in' })
  @ApiForbiddenResponse({ description: 'Only registered users may book' })
  @ApiNotFoundResponse({ description: 'Booking not found or not yours' })
  @ApiConflictResponse({
    description:
      'Booking is not HELD (already submitted, cancelled or expired), the hold ran out, or a flight/airline can no longer be booked',
  })
  createBooking(
    @Body() dto: CreateFlightBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FlightBookingResponse> {
    return this.flightBookingsService.createBooking(user.userId, dto);
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
