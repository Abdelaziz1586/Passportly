import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
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
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentParamsDto } from './dto/payment-params.dto';
import { RefundParamsDto } from './dto/refund-params.dto';
import { RefundResponseDto } from './dto/refund-response.dto';
import {
  PaymentIntentResponseDto,
  PaymentResponseDto,
} from './dto/payment-response.dto';
import {
  AcceptPoliciesResponseDto,
  BookingPoliciesResponseDto,
} from './dto/booking-policies-response.dto';
import {
  PaymentWebhookService,
  WebhookResult,
} from './payment-webhook.service';
import {
  PaymentIntentResponse,
  PaymentResponse,
  PaymentsService,
} from './payments.service';
import { RefundsService } from './refunds.service';
import type { RefundResponse } from './refunds.service';

@ApiTags('Payments & Refunds')
@Controller()
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly bookingPoliciesService: BookingPoliciesService,
    private readonly paymentWebhookService: PaymentWebhookService,
    private readonly refundsService: RefundsService,
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
  @ApiOperation({
    summary: 'PAY-01: Create Stripe payment intent for booking',
    description:
      'Starts paying a PENDING_PAYMENT flight booking or hotel reservation inside its 10-minute hold (the hold is never extended). The amount is the booking total stored on the server, never taken from the request. The policies must have been accepted first. Creates a Stripe test-mode PaymentIntent and returns its clientSecret for Stripe Elements: card details go to Stripe only and never reach this backend. The booking is NOT confirmed here; only the verified Stripe webhook confirms it. When the hold expires the PaymentIntent is cancelled.',
  })
  @ApiCreatedResponse({
    description: 'PaymentIntent created: use clientSecret with Stripe Elements',
    type: PaymentIntentResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid body, or Stripe rejected the amount/currency',
  })
  @ApiUnauthorizedResponse({ description: 'Not signed in' })
  @ApiForbiddenResponse({ description: 'Only registered users may pay' })
  @ApiNotFoundResponse({ description: 'Booking not found or not yours' })
  @ApiConflictResponse({
    description:
      'Booking is not PENDING_PAYMENT, its hold expired, policies not accepted, passenger details missing, or a payment already exists for it',
  })
  @ApiServiceUnavailableResponse({
    description: 'Stripe is not configured or not reachable',
  })
  createPayment(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentIntentResponse> {
    return this.paymentsService.createPayment(user.userId, dto);
  }

  // Static route: must stay above the ':id' routes.
  @Public()
  @Post('payments/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'PAY-01: Stripe webhook endpoint for payment verification',
    description:
      'Called by Stripe, not by users. Verifies the stripe-signature header over the raw request body with STRIPE_WEBHOOK_SECRET; an invalid or missing signature is rejected with 400 and nothing is read. Handles payment_intent.succeeded (the only thing that moves a booking from PENDING_PAYMENT to CONFIRMED, converts held inventory to booked, creates e-ticket numbers and notifies), payment_intent.payment_failed, payment_intent.canceled and charge.refunded. Idempotent: a repeated event changes nothing and notifies nothing.',
  })
  @ApiHeader({
    name: 'stripe-signature',
    required: true,
    description: 'Stripe signature of the raw body',
  })
  @ApiBody({
    description: 'The Stripe event JSON exactly as sent by Stripe',
    schema: { type: 'object', additionalProperties: true },
  })
  @ApiOkResponse({
    description: 'Event accepted (outcome says what happened)',
    schema: {
      type: 'object',
      properties: {
        received: { type: 'boolean', example: true },
        outcome: { type: 'string', example: 'confirmed' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Missing or invalid stripe-signature, or no raw body',
  })
  @ApiServiceUnavailableResponse({
    description: 'Stripe webhook secret is not configured',
  })
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<WebhookResult> {
    const event = this.paymentWebhookService.verifyEvent(
      req.rawBody,
      signature,
    );
    return this.paymentWebhookService.handleEvent(event);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('payments/:id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'PAY-01: Retry a failed or pending payment',
    description:
      'After a failed (or still pending) attempt, returns a usable clientSecret so the owner can pay again until the hold expires. The same PaymentIntent is reused when Stripe still allows it, otherwise a new one is created. The payment goes back to PENDING. Only the owner; the booking must still be PENDING_PAYMENT with a running hold.',
  })
  @ApiOkResponse({
    description: 'Payment is PENDING again; use the clientSecret',
    type: PaymentIntentResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiUnauthorizedResponse({ description: 'Not signed in' })
  @ApiForbiddenResponse({ description: 'Only registered users may retry' })
  @ApiNotFoundResponse({ description: 'Payment not found or not yours' })
  @ApiConflictResponse({
    description:
      'Payment is not FAILED/PENDING, it is processing or already succeeded, or the booking hold expired',
  })
  @ApiServiceUnavailableResponse({
    description: 'Stripe is not configured or not reachable',
  })
  retryPayment(
    @Param() params: PaymentParamsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentIntentResponse> {
    return this.paymentsService.retryPayment(user.userId, params.id);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER, Role.ADMIN)
  @Get('payments/:id')
  @ApiOperation({
    summary: 'PAY-01: Get payment status and details',
    description:
      'Returns status, amount, currency, timestamps and failureReason. The owner can read their own payments; an admin can read any. Never returns card details or the client secret.',
  })
  @ApiOkResponse({ description: 'The payment', type: PaymentResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiUnauthorizedResponse({ description: 'Not signed in' })
  @ApiForbiddenResponse({
    description: 'Only registered users and admins may read payments',
  })
  @ApiNotFoundResponse({ description: 'Payment not found or not yours' })
  getPayment(
    @Param() params: PaymentParamsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentResponse> {
    return this.paymentsService.getPayment(user.userId, user.role, params.id);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER, Role.ADMIN)
  @Get('refunds/:id')
  @ApiOperation({
    summary: 'PAY-03: Get refund status and details',
    description:
      'Returns the refund of a cancellation: amount, currency, status (PENDING = being processed, SUCCEEDED = refunded, FAILED), the reason, how the amount was computed from the tiers stored on the booking (policyCalculationNotes) and processedAt. The refund itself is issued through the Stripe Refunds API when a booking is cancelled. The owner can read their own refunds; an admin can read any.',
  })
  @ApiOkResponse({ description: 'The refund', type: RefundResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiUnauthorizedResponse({ description: 'Not signed in' })
  @ApiForbiddenResponse({
    description: 'Only registered users and admins may read refunds',
  })
  @ApiNotFoundResponse({ description: 'Refund not found or not yours' })
  getRefund(
    @Param() params: RefundParamsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RefundResponse> {
    return this.refundsService.getRefund(user.userId, user.role, params.id);
  }
}
