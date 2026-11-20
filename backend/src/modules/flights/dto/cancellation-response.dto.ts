import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus, RefundStatus } from '../../../common/enums';

/** Swagger-only shapes: they document what FlightCancellationService returns. */

export class CancellationTierDto {
  @ApiProperty({ description: 'Tier threshold in days before departure' })
  daysBeforeDeparture: number;
  @ApiProperty({ description: 'Refund percentage of that tier (0-100)' })
  refundPercentage: number;
}

export class CancellationPreviewDto {
  @ApiProperty() bookingId: string;
  @ApiProperty() bookingReference: string;
  @ApiProperty({ enum: BookingStatus }) status: BookingStatus;
  @ApiProperty({
    type: Date,
    description:
      'Departure of the outbound flight (UTC): the tier is chosen from it',
  })
  departureTime: Date;
  @ApiProperty({ description: 'Whole days left until departure' })
  daysRemaining: number;
  @ApiProperty({ description: 'Major units, e.g. 340.50' }) totalPrice: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({
    type: CancellationTierDto,
    nullable: true,
    description: 'The tier that applies; null when none does (refund 0%)',
  })
  tierApplied: CancellationTierDto | null;
  @ApiProperty({ description: 'Refund percentage of the whole booking total' })
  refundPercentage: number;
  @ApiProperty({ description: 'The money that comes back, in major units' })
  refundAmount: number;
  @ApiProperty({ description: 'How the amount was computed' })
  policyCalculationNotes: string;
}

export class CancellationRefundDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: RefundStatus }) status: RefundStatus;
  @ApiProperty() amount: number;
  @ApiProperty({ example: 'USD' }) currency: string;
}

export class CancellationResultDto {
  @ApiProperty() bookingId: string;
  @ApiProperty() bookingReference: string;
  @ApiProperty({ enum: BookingStatus, example: BookingStatus.CANCELLED })
  status: BookingStatus;
  @ApiProperty({ type: Date }) cancelledAt: Date;
  @ApiProperty() refundPercentage: number;
  @ApiProperty() refundAmount: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty() policyCalculationNotes: string;
  @ApiProperty({
    type: CancellationRefundDto,
    nullable: true,
    description:
      'The refund created for this cancellation (status shown again on the booking and GET /refunds/:id); null when the refund is 0',
  })
  refund: CancellationRefundDto | null;
}
