import {
  Body,
  Controller,
  Get,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CreateFlightBookingDto } from './dto/create-flight-booking.dto';
import { ETicketQueryDto, ETicketFormat } from './dto/e-ticket-query.dto';
import { ETicketResponseDto } from './dto/e-ticket-response.dto';
import { FlightBookingDetailsResponseDto } from './dto/flight-booking-details-response.dto';
import { FlightBookingIdParamDto } from './dto/flight-booking-id-param.dto';
import { FlightBookingListResponseDto } from './dto/flight-booking-list-response.dto';
import { HoldSeatsDto } from './dto/hold-seats.dto';
import { ListFlightBookingsQueryDto } from './dto/list-flight-bookings-query.dto';
import type { ETicket } from './flight-e-ticket';
import { FlightBookingViewService } from './flight-booking-view.service';
import type { FlightBookingDetails } from './flight-booking-view';
import { FlightETicketService } from './flight-e-ticket.service';
import {
  FlightBookingListResponse,
  FlightBookingResponse,
  FlightBookingsService,
  FlightHoldResponse,
} from './flight-bookings.service';

@ApiTags('Flight Bookings')
@ApiCookieAuth()
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(
    private readonly flightBookingsService: FlightBookingsService,
    private readonly flightETicketService: FlightETicketService,
    private readonly flightBookingViewService: FlightBookingViewService,
  ) {}

  @Roles(Role.REGISTERED_USER)
  @Post('hold')
  @ApiOperation({
    summary: 'FLT-22: Place concurrency-safe temporary seat hold',
    description:
      'Reserves seats on every leg and creates a PENDING_PAYMENT booking (no passenger details yet) that expires 10 minutes after creation (the hold is never extended; payment can be retried until it expires). Infants (under 2) take no seat and pay 10% of the cabin fare per leg. There is no passenger cap: availability decides, and a 409 means not enough seats.',
  })
  @ApiCreatedResponse({
    description:
      'Seats held; booking is PENDING_PAYMENT without passenger details',
  })
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
      'Takes the PENDING_PAYMENT booking created by /flight-bookings/hold (which has no passenger details yet) plus one entry per traveller, prices extra baggage and snapshots the airline policies. The status stays PENDING_PAYMENT: it is never CONFIRMED here, only a verified payment confirms it. A second submit returns 409. The hold is not extended, so pay before holdExpiresAt. Passenger types must match the age on the outbound departure date (Adult 12+, Child 2-11, Infant under 2), and the passenger counts must equal the hold.',
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
      'Booking is not PENDING_PAYMENT (confirmed, cancelled, expired), passenger details were already submitted, the hold ran out, or a flight/airline can no longer be booked',
  })
  createBooking(
    @Body() dto: CreateFlightBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FlightBookingResponse> {
    return this.flightBookingsService.createBooking(user.userId, dto);
  }

  @Roles(Role.REGISTERED_USER, Role.ADMIN)
  @Get()
  @ApiOperation({
    summary: 'FLT-25: List current user flight bookings',
    description:
      "Paginated list of the signed-in user's own flight bookings (admins also see only their own). Filter by one or more statuses and sort by createdAt, departureDate (first leg) or totalPrice. A seat hold that has run out is expired first, so it is never listed as PENDING_PAYMENT.",
  })
  @ApiOkResponse({
    description: 'One page of bookings and the pagination meta',
    type: FlightBookingListResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid page, limit (1-50), status, sortBy or sortOrder, or an unknown query parameter',
  })
  @ApiUnauthorizedResponse({ description: 'Not signed in' })
  @ApiForbiddenResponse({
    description: 'Only registered users and admins may list bookings',
  })
  listBookings(
    @Query() query: ListFlightBookingsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FlightBookingListResponse> {
    return this.flightBookingsService.listBookings(user.userId, query);
  }

  @Roles(Role.REGISTERED_USER, Role.ADMIN, Role.AIRLINE_MODERATOR)
  @Get(':id')
  @ApiOperation({
    summary: 'FLT-25: Get flight booking details',
    description:
      "Full details of one booking: every leg (flight, airline, cabin, times in UTC, seats), the passengers (passport masked, e-ticket numbers), prices, the policies captured at booking, status and timestamps, and a payment summary (status, amount, paidAt; never card data). Readable by the booking's owner, an admin, or the airline moderator of an airline operating a flight of it; for anyone else the booking looks like it does not exist. An airline moderator only gets a manifest of the legs of their own airline (names, masked passport, e-ticket numbers, seats) and no prices, payment, policies or date of birth, nationality or fees. A hold that ran out is reported as EXPIRED.",
  })
  @ApiOkResponse({
    description: 'The booking',
    type: FlightBookingDetailsResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiUnauthorizedResponse({ description: 'Not signed in' })
  @ApiForbiddenResponse({
    description:
      'Only registered users, admins and airline moderators may call this',
  })
  @ApiNotFoundResponse({ description: 'Booking not found or not yours' })
  getBooking(
    @Param() params: FlightBookingIdParamDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FlightBookingDetails> {
    return this.flightBookingViewService.getBooking(user, params.id);
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
  @ApiProduces('application/json', 'application/pdf')
  @ApiOperation({
    summary: 'FLT-23: Retrieve generated e-ticket for confirmed booking',
    description:
      "Only a CONFIRMED booking has an e-ticket. Returns the booking reference (PNR), the passengers with their e-ticket numbers (passport masked) and every flight with departure and arrival in UTC and in the airport's own IANA time zone. With ?format=pdf the same ticket is downloaded as a PDF file. Readable by the booking's owner, an admin, or the airline moderator of an airline operating a flight of the booking; for anyone else the booking looks like it does not exist.",
  })
  @ApiOkResponse({
    description: 'The e-ticket (JSON), or application/pdf with ?format=pdf',
    type: ETicketResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid id or format' })
  @ApiUnauthorizedResponse({ description: 'Not signed in' })
  @ApiForbiddenResponse({
    description:
      'Only registered users, admins and airline moderators may call this',
  })
  @ApiNotFoundResponse({ description: 'Booking not found or not yours' })
  @ApiConflictResponse({
    description:
      'The booking is not CONFIRMED yet (or any more), so it has no e-ticket',
  })
  async getETicket(
    @Param() params: FlightBookingIdParamDto,
    @Query() query: ETicketQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ETicket | StreamableFile> {
    const ticket = await this.flightETicketService.getETicket(user, params.id);
    if (query.format !== ETicketFormat.PDF) return ticket;
    return new StreamableFile(this.flightETicketService.toPdf(ticket), {
      type: 'application/pdf',
      disposition: `attachment; filename="e-ticket-${ticket.bookingReference}.pdf"`,
    });
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
