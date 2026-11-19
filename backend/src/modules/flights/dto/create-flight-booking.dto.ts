import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PassengerType } from '../../../common/enums';
import { MAX_PASSENGERS_PER_TYPE } from './hold-seats.dto';

/** Sanity bound only (adults + children + infants); the hold's counts decide the real number. */
export const MAX_PASSENGERS_PER_BOOKING = MAX_PASSENGERS_PER_TYPE * 3;
/**
 * Technical sanity bound on extraBaggageCount so absurd numbers cannot overflow
 * the price maths. It is NOT a business rule: the baggage policy has no
 * "maximum extra bags" field.
 */
export const EXTRA_BAGS_SANITY_BOUND = 100;

export enum PassengerGender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
}

const NAME_PATTERN = /^\p{L}[\p{L} '.-]*$/u;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class PassengerDetailsDto {
  @ApiProperty({ example: 'Layla', maxLength: 60 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Matches(NAME_PATTERN, {
    message:
      'firstName may only contain letters, spaces, apostrophes, dots and hyphens',
  })
  firstName: string;

  @ApiProperty({ example: 'Hassan', maxLength: 60 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @Matches(NAME_PATTERN, {
    message:
      'lastName may only contain letters, spaces, apostrophes, dots and hyphens',
  })
  lastName: string;

  @ApiProperty({ enum: PassengerType, example: PassengerType.ADULT })
  @IsEnum(PassengerType)
  type: PassengerType;

  @ApiProperty({
    example: '1990-05-17',
    description:
      'YYYY-MM-DD, not in the future. Must fit the passenger type on the outbound departure date: Adult 12+, Child 2-11, Infant under 2.',
  })
  @Matches(DATE_ONLY_PATTERN, {
    message: 'dateOfBirth must be formatted YYYY-MM-DD',
  })
  @IsISO8601({ strict: true })
  dateOfBirth: string;

  @ApiProperty({ enum: PassengerGender, example: PassengerGender.FEMALE })
  @IsEnum(PassengerGender)
  gender: PassengerGender;

  @ApiProperty({
    example: 'A1234567',
    description:
      '5-20 letters or digits. Never logged; responses show only the last 4 characters.',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9]{5,20}$/, {
    message: 'passportNumber must be 5-20 letters or digits',
  })
  passportNumber: string;

  @ApiProperty({
    example: '2032-01-31',
    description: 'YYYY-MM-DD, must not be before the last flight lands',
  })
  @Matches(DATE_ONLY_PATTERN, {
    message: 'passportExpiry must be formatted YYYY-MM-DD',
  })
  @IsISO8601({ strict: true })
  passportExpiry: string;

  @ApiProperty({ example: 'EG', description: 'Country code, 2 or 3 letters' })
  @Matches(/^[A-Za-z]{2,3}$/, {
    message: 'nationality must be a 2 or 3 letter country code',
  })
  nationality: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: EXTRA_BAGS_SANITY_BOUND,
    default: 0,
    description:
      'Extra checked bags beyond the airline allowance, charged on every leg (fee = price per extra bag x bags). Infants cannot add bags.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(EXTRA_BAGS_SANITY_BOUND)
  extraBaggageCount: number = 0;

  @ApiPropertyOptional({
    example: 20,
    description:
      'Weight in kg of each extra bag. When given it must not exceed the cabin maximum weight per bag on any leg, and extraBaggageCount must be above 0.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  extraBaggageWeightKg?: number;
}

export class CreateFlightBookingDto {
  @ApiProperty({
    description: 'The HELD booking returned by POST /flight-bookings/hold',
    example: '665f1c2e8a1b2c3d4e5f6a7b',
  })
  @IsMongoId()
  bookingId: string;

  @ApiProperty({
    type: [PassengerDetailsDto],
    description:
      'Exactly the adults, children and infants that were held (one entry per traveller).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PASSENGERS_PER_BOOKING)
  @ValidateNested({ each: true })
  @Type(() => PassengerDetailsDto)
  passengers: PassengerDetailsDto[];
}
