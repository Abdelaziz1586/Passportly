import { Controller, Get, NotImplementedException, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { PaymentsService } from './payments.service';

@ApiTags('Payments & Refunds')
@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Get('bookings/:type/:id/policies')
  @ApiOperation({
    summary:
      'PAY-02: Get provider policies for a flight or hotel booking before payment',
  })
  getBookingPolicies() {
    throw new NotImplementedException(
      'GET /api/bookings/:type/:id/policies not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('bookings/:type/:id/accept-policies')
  @ApiOperation({
    summary: 'PAY-02: Record policy acceptance with timestamp before payment',
  })
  acceptBookingPolicies() {
    throw new NotImplementedException(
      'POST /api/bookings/:type/:id/accept-policies not implemented yet',
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
