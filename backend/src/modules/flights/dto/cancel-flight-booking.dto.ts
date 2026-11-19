import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const CANCELLATION_REASON_MAX_LENGTH = 300;

export class CancelFlightBookingDto {
  @ApiProperty({
    description:
      'Confirmation of the cancellation (GEN-03). Must be true: look at GET /flight-bookings/:id/cancellation-preview first to see the refund.',
    example: true,
  })
  // main.ts enables implicit conversion, which would turn the strings "no" and
  // "false" into true: keep the raw value so only a real boolean true passes.
  @Transform(({ obj }: { obj: { confirm?: unknown } }) => obj.confirm)
  @Equals(true, { message: 'confirm must be true to cancel the booking' })
  confirm: boolean;

  @ApiPropertyOptional({
    description: 'Why the booking is cancelled (optional)',
    maxLength: CANCELLATION_REASON_MAX_LENGTH,
    example: 'Change of plans',
  })
  // Keep the raw value: implicit conversion would turn a number or an object into a string.
  @Transform(({ obj }: { obj: { reason?: unknown } }) => obj.reason)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(CANCELLATION_REASON_MAX_LENGTH)
  reason?: string;
}
