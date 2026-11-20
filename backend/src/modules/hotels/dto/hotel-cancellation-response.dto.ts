import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus } from '../../../common/enums';

/** Swagger-only shapes: they document what HotelCancellationService returns. */

export class HotelCancellationTierDto {
  @ApiProperty({ description: 'Tier threshold in days before check-in' })
  daysBeforeCheckIn: number;
  @ApiProperty({ description: 'Refund percentage of that tier (0-100)' })
  refundPercentage: number;
}

export class HotelCancellationPreviewDto {
  @ApiProperty() bookingId: string;
  @ApiProperty() bookingReference: string;
  @ApiProperty({ enum: BookingStatus }) status: BookingStatus;
  @ApiProperty({
    type: Date,
    description: 'Check-in date (UTC midnight): the tier is chosen from it',
  })
  checkInDate: Date;
  @ApiProperty({ description: 'Whole days left until check-in' })
  daysRemaining: number;
  @ApiProperty({ description: 'Major units, e.g. 540.00' }) totalPrice: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({
    type: HotelCancellationTierDto,
    nullable: true,
    description: 'The tier that applies; null when none does (refund 0%)',
  })
  tierApplied: HotelCancellationTierDto | null;
  @ApiProperty({
    description: 'Refund percentage of the whole reservation total',
  })
  refundPercentage: number;
  @ApiProperty({ description: 'The money that comes back, in major units' })
  refundAmount: number;
  @ApiProperty({ description: 'How the amount was computed' })
  policyCalculationNotes: string;
}
