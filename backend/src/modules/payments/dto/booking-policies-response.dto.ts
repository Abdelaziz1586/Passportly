import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus, BookingType } from '../../../common/enums';

/** Swagger-only shapes: they document what BookingPoliciesService returns. */

export class BookingPoliciesResponseDto {
  @ApiProperty({ enum: BookingType }) bookingType: BookingType;
  @ApiProperty() bookingId: string;
  @ApiProperty() bookingReference: string;
  @ApiProperty({
    enum: BookingStatus,
    description: 'A hold that ran out is reported as EXPIRED',
  })
  status: BookingStatus;
  @ApiProperty({ nullable: true, type: Date }) holdExpiresAt: Date | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Snapshot taken when the booking was created. Flight: per leg, the airline baggage policy and cancellation tiers (days before departure -> refund %). Hotel: check-in/check-out times and cancellation tiers (days before check-in -> refund %).',
  })
  policies: Record<string, unknown>;
  @ApiProperty({ description: 'true once the user accepted the policies' })
  accepted: boolean;
  @ApiProperty({ nullable: true, type: Date }) policyAcceptedAt: Date | null;
  @ApiProperty({ nullable: true, type: String }) policyAcceptedBy:
    string | null;
}

export class AcceptPoliciesResponseDto {
  @ApiProperty({ enum: BookingType }) bookingType: BookingType;
  @ApiProperty() bookingId: string;
  @ApiProperty() bookingReference: string;
  @ApiProperty({ type: Date }) policyAcceptedAt: Date;
  @ApiProperty() policyAcceptedBy: string;
}
