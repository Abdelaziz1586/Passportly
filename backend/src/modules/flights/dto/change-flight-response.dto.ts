import { ApiProperty } from '@nestjs/swagger';
import {
  BookingStatus,
  CabinClass,
  PaymentStatus,
} from '../../../common/enums';
import { CancellationRefundDto } from './cancellation-response.dto';

/** Swagger-only shapes: they document what FlightChangeService returns. */

export class ChangeLegSideDto {
  @ApiProperty() flightId: string;
  @ApiProperty() flightNumber: string;
  @ApiProperty({ type: Date }) departureTime: Date;
  @ApiProperty({ type: Date }) arrivalTime: Date;
}

export class ChangeLegDto {
  @ApiProperty() legIndex: number;
  @ApiProperty({ enum: CabinClass }) cabinClass: CabinClass;
  @ApiProperty({ type: ChangeLegSideDto }) from: ChangeLegSideDto;
  @ApiProperty({ type: ChangeLegSideDto }) to: ChangeLegSideDto;
  @ApiProperty({ description: 'The fare of the new leg for the whole party' })
  newFare: number;
  @ApiProperty() newAirline: string;
  @ApiProperty({
    description:
      'Refund tiers of the new airline (days before departure → refund %)',
    example: [{ daysBeforeDeparture: 7, refundPercentage: 100 }],
  })
  newCancellationTiers: {
    daysBeforeDeparture: number;
    refundPercentage: number;
  }[];
  @ApiProperty({ description: 'Extra bag fee of the new airline' })
  newExtraBagFee: number;
}

export class ChangeQuoteResponseDto {
  @ApiProperty() bookingId: string;
  @ApiProperty() bookingReference: string;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({ description: 'Total of the booking now' })
  currentTotal: number;
  @ApiProperty({ description: 'Total after the change' }) newTotal: number;
  @ApiProperty({
    description:
      'New total minus current total. Positive: the traveller pays it first and the change is applied when the payment succeeds. Negative: applied at once and refunded. Zero: applied at once.',
  })
  difference: number;
  @ApiProperty({
    enum: ['PAY_DIFFERENCE', 'REFUND_DIFFERENCE', 'NO_DIFFERENCE'],
  })
  outcome: 'PAY_DIFFERENCE' | 'REFUND_DIFFERENCE' | 'NO_DIFFERENCE';
  @ApiProperty({ type: [ChangeLegDto] }) legs: ChangeLegDto[];
}

export class ChangePaymentDto {
  @ApiProperty() paymentId: string;
  @ApiProperty({
    description: 'Pass this to Stripe Elements to pay the difference',
  })
  clientSecret: string;
  @ApiProperty() stripePaymentIntentId: string;
  @ApiProperty() amount: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({ enum: PaymentStatus }) status: PaymentStatus;
  @ApiProperty({
    type: Date,
    description: 'The offer ends here; unpaid, nothing changes',
  })
  expiresAt: Date;
}

export class ChangeFlightResponseDto extends ChangeQuoteResponseDto {
  @ApiProperty() changeId: string;
  @ApiProperty({
    enum: ['APPLIED', 'PENDING_PAYMENT'],
    description:
      'APPLIED: the booking has the new flights. PENDING_PAYMENT: the booking keeps its old flights and seats until the payment of the difference is confirmed.',
  })
  changeStatus: 'APPLIED' | 'PENDING_PAYMENT';
  @ApiProperty({
    enum: BookingStatus,
    description: 'Always CONFIRMED (GEN-11)',
  })
  bookingStatus: BookingStatus;
  @ApiProperty({
    type: ChangePaymentDto,
    nullable: true,
    description: 'Only when the new fare is higher',
  })
  payment: ChangePaymentDto | null;
  @ApiProperty({
    type: CancellationRefundDto,
    nullable: true,
    description: 'Only when the new fare is lower (the first of the refunds)',
  })
  refund: CancellationRefundDto | null;
}
