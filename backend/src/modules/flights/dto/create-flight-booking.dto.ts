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
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PassengerType } from '../../../common/enums';

/** Most extra checked bags one passenger may buy (per leg). The brief sets no limit. */
export const MAX_EXTRA_BAGS_PER_PASSENGER = 5;
/** 9 seats (adults + children) plus up to 9 lap infants, mirroring the hold rules. */
export const MAX_PASSENGERS_PER_BOOKING = 18;

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
    description: 'YYYY-MM-DD, not in the future',
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
    maximum: MAX_EXTRA_BAGS_PER_PASSENGER,
    default: 0,
    description:
      'Extra checked bags beyond the airline allowance, charged on every leg. Infants cannot add bags.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_EXTRA_BAGS_PER_PASSENGER)
  extraBaggageCount: number = 0;
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
