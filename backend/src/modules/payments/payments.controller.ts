import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  Param,
  Post,
} from '@nestjs/common';
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
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import {
  AcceptPoliciesResponse,
  BookingPoliciesResponse,
  BookingPoliciesService,
} from './booking-policies.service';
import { AcceptPoliciesDto } from './dto/accept-policies.dto';
import { BookingParamsDto } from './dto/booking-params.dto';
import {
  AcceptPoliciesResponseDto,
  BookingPoliciesResponseDto,
} from './dto/booking-policies-response.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Payments & Refunds')
@Controller()
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly bookingPoliciesService: BookingPoliciesService,
  ) {}

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Get('bookings/:type/:id/policies')
  @ApiOperation({
    summary:
      'PAY-02: Get provider policies for a flight or hotel booking before payment',
    description:
      "Returns the policies stored on the booking when it was created: airline baggage and cancellation tiers per flight leg, or hotel check-in/check-out times and cancellation tiers. Also returns whether (and when) the owner accepted them. :type is 'flight' or 'hotel'. Only the booking's owner can read it; another user's booking is a 404.",
  })
  @ApiOkResponse({
    description: 'Policies and acceptance state',
    type: BookingPoliciesResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid :type or :id' })
  @ApiUnauthorizedResponse({ description: 'Not signed in' })
  @ApiForbiddenResponse({ description: 'Only registered users may call this' })
  @ApiNotFoundResponse({ description: 'Booking not found or not yours' })
  @ApiConflictResponse({
    description:
      'The booking has no policies yet (a flight booking needs its passenger details first)',
  })
  getBookingPolicies(
    @Param() params: BookingParamsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BookingPoliciesResponse> {
    return this.bookingPoliciesService.getPolicies(
      user.userId,
      params.type,
      params.id,
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('bookings/:type/:id/accept-policies')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'PAY-02: Record policy acceptance with timestamp before payment',
    description:
      'Sends the acceptance checkbox ({ "accepted": true }). Stores policyAcceptedAt (server time) and policyAcceptedBy (the signed-in user) on the booking. Payment is blocked until this was done. Only a PENDING_PAYMENT booking whose 10-minute hold is still running can accept; the hold is never extended. A second call keeps the first timestamp.',
  })
  @ApiOkResponse({
    description: 'Acceptance stored',
    type: AcceptPoliciesResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid :type or :id, or accepted is not true',
  })
  @ApiUnauthorizedResponse({ description: 'Not signed in' })
  @ApiForbiddenResponse({ description: 'Only registered users may call this' })
  @ApiNotFoundResponse({ description: 'Booking not found or not yours' })
  @ApiConflictResponse({
    description:
      'Booking is not PENDING_PAYMENT, its hold expired, or it has no policies yet',
  })
  acceptBookingPolicies(
    @Param() params: BookingParamsDto,
    @Body() _dto: AcceptPoliciesDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AcceptPoliciesResponse> {
    return this.bookingPoliciesService.acceptPolicies(
      user.userId,
      params.type,
      params.id,
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('payments')
  @ApiOperation({ summary: 'PAY-01: Create Stripe payment intent for booking' })
  createPayment() {
    throw new NotImplementedException('POST /api/payments not implemented yet');
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('payments/:id/retry')
  @ApiOperation({ summary: 'PAY-01: Retry a failed or pending payment' })
  retryPayment() {
    throw new NotImplementedException(
      'POST /api/payments/:id/retry not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER, Role.ADMIN)
  @Get('payments/:id')
  @ApiOperation({ summary: 'PAY-01: Get payment status and details' })
  getPayment() {
    throw new NotImplementedException(
      'GET /api/payments/:id not implemented yet',
    );
  }

  @Public()
  @Post('payments/webhook')
  @ApiOperation({
    summary: 'PAY-01: Stripe webhook endpoint for payment verification',
  })
  handleWebhook() {
    throw new NotImplementedException(
      'POST /api/payments/webhook not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER, Role.ADMIN)
  @Get('refunds/:id')
  @ApiOperation({ summary: 'PAY-03: Get refund status and details' })
  getRefund() {
    throw new NotImplementedException(
      'GET /api/refunds/:id not implemented yet',
    );
  }
}
