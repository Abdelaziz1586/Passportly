import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ChangedLegDto {
  @ApiProperty({
    description:
      'Which leg of the booking to replace: 0 = outbound, 1 = return of a round trip.',
    minimum: 0,
    maximum: 1,
    example: 0,
  })
  @Transform(({ obj }: { obj: { legIndex?: unknown } }) => obj.legIndex)
  @IsInt()
  @Min(0)
  @Max(1)
  legIndex: number;

  @ApiProperty({
    description:
      'The new flight: same origin and destination and the same cabin as the leg it replaces.',
    example: '665f1c2e8a1b2c3d4e5f6a7b',
  })
  @Transform(({ obj }: { obj: { flightId?: unknown } }) => obj.flightId)
  @IsMongoId()
  flightId: string;
}

/** Which legs to replace (used by the preview as well as the change itself). */
export class ChangeFlightPreviewDto {
  @ApiProperty({
    type: [ChangedLegDto],
    description:
      'One or two legs to replace; a leg can only appear once. A round trip may change one or both legs.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => ChangedLegDto)
  legs: ChangedLegDto[];
}

export class ChangeFlightDto extends ChangeFlightPreviewDto {
  @ApiProperty({
    description:
      'The traveller accepted the policies of the new flight(s) (shown by the preview). Must be true.',
    example: true,
  })
  // main.ts enables implicit conversion, which would turn "false" into true: keep the raw value.
  @Transform(
    ({ obj }: { obj: { acceptPolicies?: unknown } }) => obj.acceptPolicies,
  )
  @Equals(true, { message: 'acceptPolicies must be true to change the flight' })
  acceptPolicies: boolean;

  @ApiPropertyOptional({
    description:
      'The fare difference shown by the preview (new total minus old total, signed). If the price is no longer this the change is refused with 409 so the traveller looks again.',
    example: 120,
  })
  @Transform(
    ({ obj }: { obj: { expectedDifference?: unknown } }) =>
      obj.expectedDifference,
  )
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(-1_000_000_000)
  @Max(1_000_000_000)
  expectedDifference?: number;
}
