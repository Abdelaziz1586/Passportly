import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { FlightBookingIdParamDto } from './dto/flight-booking-id-param.dto';
import {
  SeatMapResponseDto,
  SeatSelectionResponseDto,
} from './dto/seat-response.dto';
import { SelectSeatDto } from './dto/select-seat.dto';
import { FlightSeatsService } from './flight-seats.service';

/**
 * FLT-28 (optional): seat selection. Same base path as FlightBookingsController;
 * the routes end in /seat and /seat-map, so they cannot collide with its :id routes.
 */
@ApiTags('Flight Bookings')
@ApiCookieAuth()
@Roles(Role.REGISTERED_USER)
@Controller('flight-bookings')
export class FlightSeatsController {
  constructor(private readonly flightSeatsService: FlightSeatsService) {}

  @Patch(':id/seat')
  @ApiOperation({
    summary: 'FLT-28 (Optional): Select or change a passenger seat',
    description:
      'The owner chooses (or changes) the seat of one non-infant passenger on one leg. The seat must exist in the passenger’s own cabin (rows are derived from the cabin size, letters A-F, for example 12C), the leg must not have departed, and the booking must be CONFIRMED or a live PENDING_PAYMENT hold that already has passenger details. One passenger per seat on a flight: if two requests ask for the same seat, exactly one succeeds and the other gets 409. Changing a seat frees the old one; cancelling or expiring the booking frees all of them. Seats cost nothing.',
  })
  @ApiOkResponse({ type: SeatSelectionResponseDto })
  @ApiBadRequestResponse({
    description:
      'Invalid input, seat not in the passenger’s cabin, infant passenger, or no such leg',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiForbiddenResponse({ description: 'Only registered users may call this' })
  @ApiNotFoundResponse({
    description: 'Booking not found or not yours, or passenger not on it',
  })
  @ApiConflictResponse({
    description:
      'Seat taken, flight departed or cancelled, or the booking is expired/cancelled/has no passengers',
  })
  selectSeat(
    @Param() params: FlightBookingIdParamDto,
    @Body() dto: SelectSeatDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SeatSelectionResponseDto> {
    return this.flightSeatsService.selectSeat(user.userId, params.id, dto);
  }

  @Get(':id/seat-map')
  @ApiOperation({
    summary: 'FLT-28 (Optional): Seat map of the legs of a booking',
    description:
      'For each leg: the rows and letters of the passenger’s cabin, the seats already taken (by anyone) and this booking’s own seats. Helps a traveller see which seats can still be chosen.',
  })
  @ApiOkResponse({ type: SeatMapResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiForbiddenResponse({ description: 'Only registered users may call this' })
  @ApiNotFoundResponse({ description: 'Booking not found or not yours' })
  getSeatMap(
    @Param() params: FlightBookingIdParamDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SeatMapResponseDto> {
    return this.flightSeatsService.getSeatMap(user.userId, params.id);
  }
}
