import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { BookingStatus } from '../../../common/enums';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const list = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.split(',').map((v) => v.trim()) : value;

export class HotelImageDto {
  @ApiPropertyOptional({
    description:
      'Existing image identifier; metadata is verified against server storage',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsMongoId()
  _id?: string;

  @ApiPropertyOptional({
    description: 'Existing timestamp; the server derives the stored value',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsDateString()
  uploadedAt?: string;
  @ApiProperty({ example: '/uploads/00000000-0000-4000-8000-000000000000.jpg' })
  @IsString()
  @Matches(/^\/uploads\/[a-f\d-]{36}\.(jpg|png)$/i)
  url: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[a-f\d-]{36}\.(jpg|png)$/i)
  filename: string;

  @ApiProperty({ enum: ['image/jpeg', 'image/png'] })
  @IsIn(['image/jpeg', 'image/png'])
  mimeType: string;

  @ApiProperty({ maximum: 5242880 })
  @IsInt()
  @Min(1)
  @Max(5242880)
  sizeBytes: number;
}

export class CreateHotelDto {
  @ApiProperty({ example: 'Nile Hotel', maxLength: 150 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name: string;

  @ApiProperty({ example: '12 Nile Street', maxLength: 300 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  address: string;

  @ApiProperty({ description: 'Seeded City ObjectId' })
  @IsMongoId()
  city: string;

  @ApiPropertyOptional({
    description: 'Must match the selected city; derived when omitted',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsMongoId()
  country?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, default: 3 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(5)
  starRating?: number;

  @ApiPropertyOptional({ type: [String], maxItems: 50 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(80, { each: true })
  amenities?: string[];

  @ApiPropertyOptional({
    type: [HotelImageDto],
    maxItems: 5,
    description: 'Only images previously stored by the upload endpoint',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique((image: HotelImageDto | null) => image?.filename)
  @ValidateNested({ each: true })
  @Type(() => HotelImageDto)
  images?: HotelImageDto[];

  @ApiPropertyOptional()
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional()
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional()
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEmail()
  @MaxLength(255)
  contactEmail?: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(30)
  contactPhone?: string;

  @ApiPropertyOptional({
    enum: ['USD'],
    default: 'USD',
    description: 'Single platform currency (PAY-04)',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(upper)
  @IsIn(['USD'])
  baseCurrency?: string;
}

export class UpdateHotelDto extends PartialType(CreateHotelDto, {
  skipNullProperties: false,
}) {}

export class CreateRoomDto {
  @ApiProperty({ description: 'Room name/number, unique within this hotel' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'Double' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  roomType: string;

  @ApiProperty({ minimum: 1, example: 2 })
  @IsInt()
  @Min(1)
  @Max(100)
  numberOfBeds: number;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(100)
  maxOccupancy: number;

  @ApiProperty({ minimum: 0.01, example: 100 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000000)
  basePricePerNight: number;

  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    description:
      'Use 1 for individually bookable rooms; larger values support room-type inventory',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(10000)
  totalUnits?: number;

  @ApiPropertyOptional({ maxLength: 200 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  bedConfiguration?: string;

  @ApiPropertyOptional({ maxLength: 3000 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(3000)
  description?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(100)
  maxAdults?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100)
  maxChildren?: number;

  @ApiPropertyOptional({ enum: ['USD'], default: 'USD' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(upper)
  @IsIn(['USD'])
  currency?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 50 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  amenities?: string[];

  @ApiPropertyOptional({ type: [HotelImageDto], maxItems: 5 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => HotelImageDto)
  images?: HotelImageDto[];
}

export class UpdateRoomDto extends PartialType(CreateRoomDto, {
  skipNullProperties: false,
}) {
  // Object prevents implicit conversion of the JSON string "false" to true.
  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean | null;
}

export class DateRangeDto {
  @ApiProperty({
    example: '2027-01-01',
    description: 'Inclusive UTC calendar date',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate: string;

  @ApiProperty({
    example: '2027-01-04',
    description: 'Exclusive UTC calendar date; maximum 366 nights',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate: string;
}

export class AvailabilityFieldsDto extends DateRangeDto {
  @ApiPropertyOptional({ minimum: 0 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(10000)
  totalUnits?: number;

  @ApiPropertyOptional({
    minimum: 0.01,
    nullable: true,
    description: 'null restores the room base price',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000000)
  priceOverride?: number | null;

  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  isBlocked?: boolean | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  blockReason?: string;
}

export class StayQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 10 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
  @ApiProperty({ example: '2027-01-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  checkInDate: string;

  @ApiProperty({
    example: '2027-01-04',
    description: 'Exclusive check-out date',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  checkOutDate: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  guestCount?: number = 1;
}

export class HotelDetailsQueryDto extends PartialType(StayQueryDto, {
  skipNullProperties: false,
}) {}

export class HotelPaginationDto extends PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 100 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

export class SearchHotelsDto extends HotelPaginationDto {
  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'asc';
  @ApiProperty({ example: '2027-01-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  checkInDate: string;

  @ApiProperty({ example: '2027-01-04' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  checkOutDate: string;

  @ApiProperty({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  guestCount: number = 1;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 20 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  roomCount?: number = 1;

  @ApiPropertyOptional({
    description: 'Seeded City ObjectId; provide city, country or destination',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsMongoId()
  city?: string;

  @ApiPropertyOptional({ description: 'Seeded Country ObjectId' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsMongoId()
  country?: string;

  @ApiPropertyOptional({
    description: 'City name, country name or country code',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  destination?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  starRating?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Repeat amenities or use a comma separated list; all must match',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(list)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  amenities?: string[];
}

export class CancellationTierDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(3650)
  daysBeforeCheckIn: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  refundPercentage: number;
}

export class HotelPoliciesDto {
  @ApiProperty({ example: '15:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  checkInTime: string;

  @ApiProperty({ example: '11:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  checkOutTime: string;

  @ApiProperty({ type: Boolean })
  @IsBoolean()
  allowCancellation: boolean | null;

  @ApiProperty({
    type: [CancellationTierDto],
    description:
      'Unique thresholds; highest threshold <= days remaining applies, or 0% if none',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique((tier: CancellationTierDto | null) => tier?.daysBeforeCheckIn)
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  cancellationTiers: CancellationTierDto[];

  @ApiPropertyOptional({
    minimum: 0,
    default: 2,
    description: 'Legacy policy metadata; tiers govern refunds',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(3650)
  freeCancellationDaysBeforeCheckIn?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, default: 50 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsNumber()
  @Min(0)
  @Max(100)
  cancellationFeePercentage?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, default: 100 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsNumber()
  @Min(0)
  @Max(100)
  noShowFeePercentage?: number;

  @ApiPropertyOptional({ type: Boolean, default: true })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  childrenAllowed?: boolean | null;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  petsAllowed?: boolean | null;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  smokingAllowed?: boolean | null;

  @ApiPropertyOptional({
    maxLength: 5000,
    description: 'House rules and other terms',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  termsText?: string;
}

export class HotelReservationsQueryDto extends HotelPaginationDto {
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsIn(Object.values(BookingStatus))
  status?: BookingStatus;

  @ApiPropertyOptional({ description: 'Stay overlaps this inclusive date' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @ApiPropertyOptional({ description: 'Stay overlaps this exclusive date' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;
}

export class CreateReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ maxLength: 150 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional({
    maxLength: 1000,
    description: 'Optional written review; a rating alone is valid',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class UpdateReviewDto extends PartialType(CreateReviewDto, {
  skipNullProperties: false,
}) {}

export class ReplyReviewDto {
  @ApiProperty({ maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  replyText: string;
}
