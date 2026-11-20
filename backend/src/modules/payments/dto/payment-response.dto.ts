import { ApiProperty } from '@nestjs/swagger';
import { BookingType, PaymentStatus } from '../../../common/enums';

/** Swagger-only shapes: they document what PaymentsService returns. */

export class PaymentIntentResponseDto {
  @ApiProperty() paymentId: string;
  @ApiProperty({
    description:
      'Stripe client secret for Stripe Elements. Card details go to Stripe only and never reach this backend. It is not stored.',
  })
  clientSecret: string;
  @ApiProperty() stripePaymentIntentId: string;
  @ApiProperty({ enum: PaymentStatus }) status: PaymentStatus;
  @ApiProperty() amount: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({ enum: BookingType }) bookingType: BookingType;
  @ApiProperty() bookingId: string;
  @ApiProperty({
    type: Date,
    description: 'The booking hold; pay before this moment',
  })
  holdExpiresAt: Date;
}
