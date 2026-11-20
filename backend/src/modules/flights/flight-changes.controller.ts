import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
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
import {
  ChangeFlightDto,
  ChangeFlightPreviewDto,
} from './dto/change-flight.dto';
import {
  ChangeFlightResponseDto,
  ChangeQuoteResponseDto,
} from './dto/change-flight-response.dto';
import { FlightBookingIdParamDto } from './dto/flight-booking-id-param.dto';
import { FlightChangeService } from './flight-change.service';

/**
 * FLT-27 (optional): change the flight of a confirmed booking. Same base path as
 * FlightBookingsController; the routes end in /change-flight and
 * /change-flight-preview, so they cannot collide with its :id routes.
 */
@ApiTags('Flight Bookings')
@ApiCookieAuth()
@Roles(Role.REGISTERED_USER)
@Controller('flight-bookings')
export class FlightChangesController {
  constructor(private readonly flightChangeService: FlightChangeService) {}

  @Post(':id/change-flight-preview')
  @ApiOperation({
    summary: 'FLT-27 (Optional): Preview changing the flight of a booking',
    description:
      'Shows what changing the given leg(s) to other flights would cost: the new total, the fare difference (positive: you pay it first; negative: you get it back; zero: nothing), and the new airline policies. Nothing is changed. The new flight must fly the same route in the same cabin.',
  })
  @ApiOkResponse({ type: ChangeQuoteResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid input, other route, leg or currency',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiForbiddenResponse({ description: 'Only registered users may call this' })
  @ApiNotFoundResponse({ description: 'Booking, flight or cabin not found' })
  @ApiConflictResponse({
    description:
      'Not CONFIRMED, already departed, or the new flight cannot be booked',
  })
  preview(
    @Param() params: FlightBookingIdParamDto,
    @Body() dto: ChangeFlightPreviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChangeQuoteResponseDto> {
    return this.flightChangeService.preview(user.userId, params.id, dto);
  }

  @Patch(':id/change-flight')
  @ApiOperation({
    summary: 'FLT-27 (Optional): Change the flight of a confirmed booking',
    description:
      'The owner changes one or both legs of a CONFIRMED booking to other flights of the same route and cabin before the first flight departs; the booking stays CONFIRMED. The fare difference is computed on the server with the booking rules (infants 10%, extra bags). Equal: the flights are swapped at once. Lower: swapped at once and the difference is refunded through the Stripe Refunds API. Higher: the booking keeps its old flights and seats and the response carries a PaymentIntent client secret for the difference; the change is applied only when Stripe confirms the payment (webhook) within 10 minutes. If the new flight has no seats left by then, the difference is refunded in full and the booking stays as it was. Send acceptPolicies: true (the new airline policies are in the preview).',
  })
  @ApiOkResponse({ type: ChangeFlightResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid input, other route, leg or currency',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiForbiddenResponse({ description: 'Only registered users may call this' })
  @ApiNotFoundResponse({
    description: 'Booking not found or not yours, or flight/cabin not found',
  })
  @ApiConflictResponse({
    description:
      'Not CONFIRMED, already departed, no seats left, a change is already awaiting payment, or the price changed since the preview',
  })
  change(
    @Param() params: FlightBookingIdParamDto,
    @Body() dto: ChangeFlightDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChangeFlightResponseDto> {
    return this.flightChangeService.change(user.userId, params.id, dto);
  }
}
