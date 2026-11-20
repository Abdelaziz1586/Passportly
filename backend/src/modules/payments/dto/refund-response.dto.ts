import { ApiProperty } from '@nestjs/swagger';
import { BookingType, RefundStatus } from '../../../common/enums';

/** Swagger-only shape: it documents what RefundsService.getRefund returns. */
export class RefundResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() paymentId: string;
  @ApiProperty({ enum: BookingType }) bookingType: BookingType;
  @ApiProperty() bookingId: string;
  @ApiProperty({ description: 'Major units, e.g. 123.45' }) amount: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({
    enum: RefundStatus,
    description: 'PENDING (being processed), SUCCEEDED (refunded) or FAILED',
  })
  status: RefundStatus;
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'How the amount was computed from the tiers stored on the booking',
  })
  policyCalculationNotes: string | null;
  @ApiProperty({ nullable: true, type: String }) failureReason: string | null;
  @ApiProperty({ nullable: true, type: Date }) processedAt: Date | null;
  @ApiProperty({ type: Date }) createdAt: Date;
  @ApiProperty({ type: Date }) updatedAt: Date;
}
