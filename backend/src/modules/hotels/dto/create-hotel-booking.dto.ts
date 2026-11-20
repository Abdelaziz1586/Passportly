import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** Children are 0-17 (HTL-16). */
export const MAX_CHILD_AGE = 17;
/** Technical sanity bounds only (they keep absurd payloads out); occupancy and availability decide the real limits. */
export const MAX_ROOMS_PER_RESERVATION = 50;
export const MAX_GUESTS_PER_ROOM_FIELD = 100;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NAME_PATTERN = /^\p{L}[\p{L}\p{M} '.-]*$/u;
/** IsMongoId accepts upper-case hex; ids are compared as lower-case strings. */
const lowerCaseId = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;

export class HotelRoomSelectionDto {
  @ApiProperty({
    description: 'Room to reserve (an individually bookable unit of the hotel)',
    example: '665f1c2e8a1b2c3d4e5f6a7b',
  })
  @Transform(lowerCaseId)
  @IsMongoId()
  roomId: string;

  @ApiProperty({
    description: 'Adults staying in this room',
    example: 2,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  @Max(MAX_GUESTS_PER_ROOM_FIELD)
  adults: number;

  @ApiPropertyOptional({
    description:
      'Ages (0-17) of the children staying in this room, one entry per child',
    type: [Number],
    example: [4, 9],
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(MAX_GUESTS_PER_ROOM_FIELD)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(MAX_CHILD_AGE, { each: true })
  childrenAges?: number[];
}

export class CreateHotelBookingDto {
  @ApiProperty({
    description: 'Hotel of all the rooms',
    example: '665f1c2e8a1b2c3d4e5f6a7c',
  })
  @Transform(lowerCaseId)
  @IsMongoId()
  hotelId: string;

  @ApiProperty({
    description: 'Check-in date (YYYY-MM-DD, not in the past)',
    example: '2026-12-10',
  })
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: 'checkInDate must be YYYY-MM-DD' })
  checkInDate: string;

  @ApiProperty({
    description: 'Check-out date (YYYY-MM-DD, after check-in)',
    example: '2026-12-13',
  })
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: 'checkOutDate must be YYYY-MM-DD' })
  checkOutDate: string;

  @ApiProperty({
    description:
      'The rooms of this one reservation, with the guests of each; at least one adult in the whole reservation, no room above its maximum occupancy',
    type: [HotelRoomSelectionDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ROOMS_PER_RESERVATION)
  @ValidateNested({ each: true })
  @Type(() => HotelRoomSelectionDto)
  rooms: HotelRoomSelectionDto[];

  @ApiProperty({ example: 'Layla Hassan', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Matches(NAME_PATTERN, {
    message:
      'primaryGuestName may only contain letters, spaces, apostrophes, dots and hyphens',
  })
  primaryGuestName: string;

  @ApiProperty({ example: 'layla@example.com' })
  @IsEmail()
  @MaxLength(254)
  primaryGuestEmail: string;

  @ApiPropertyOptional({ example: '+20 100 000 0000', maxLength: 30 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(30)
  primaryGuestPhone?: string;

  @ApiPropertyOptional({ maxLength: 500, example: 'Late arrival' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(500)
  specialRequests?: string;
}
