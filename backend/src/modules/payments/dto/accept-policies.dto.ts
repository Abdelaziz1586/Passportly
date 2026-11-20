import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals } from 'class-validator';

/** The acceptance checkbox of PAY-02: it must be ticked (true) to record acceptance. */
export class AcceptPoliciesDto {
  @ApiProperty({
    description:
      'Acceptance checkbox. Must be true: the provider policies shown by GET /bookings/:type/:id/policies are accepted.',
    example: true,
  })
  // main.ts enables implicit conversion, which would turn the strings "no" and
  // "false" into true: keep the raw value so only a real boolean true passes.
  @Transform(({ obj }: { obj: { accepted?: unknown } }) => obj.accepted)
  @Equals(true, { message: 'accepted must be true to accept the policies' })
  accepted: boolean;
}
