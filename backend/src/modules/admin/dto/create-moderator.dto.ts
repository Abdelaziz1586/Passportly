import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AccountStatus, ProviderType, Role } from '../../../common/enums';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateModeratorDto {
  @ApiProperty({ example: 'airline.mod@passportly.local' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @MaxLength(255)
  email: string;

  @ApiProperty({
    example: 'ModPass123!',
    minLength: 8,
    maxLength: 128,
    description:
      'Minimum 8 characters with at least one uppercase letter, one lowercase letter, one number, and one special character',
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).+$/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  })
  password: string;

  @ApiProperty({ example: 'EgyptAir', maxLength: 100 })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'firstName is required' })
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Moderator', maxLength: 100 })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'lastName is required' })
  @MaxLength(100)
  lastName: string;

  @ApiPropertyOptional({ example: '+201001234567', maxLength: 30 })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiProperty({
    enum: [Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR],
    example: Role.AIRLINE_MODERATOR,
  })
  @IsIn([Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR], {
    message: 'role must be AIRLINE_MODERATOR or HOTEL_MODERATOR',
  })
  role: Role.AIRLINE_MODERATOR | Role.HOTEL_MODERATOR;

  @ApiProperty({
    example: '673c1f2a9c4b2d001f8a1234',
    description: 'ID of the Airline or Hotel assigned to this moderator',
  })
  @IsMongoId({ message: 'providerId must be a valid MongoDB ObjectId' })
  providerId: string;

  @ApiPropertyOptional({
    example: false,
    default: false,
    description: 'Require password change upon first login',
  })
  @IsOptional()
  @IsBoolean()
  mustChangePassword?: boolean;
}

export class ModeratorAssignmentSummaryDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a9999' })
  id: string;

  @ApiProperty({ enum: ProviderType, example: ProviderType.AIRLINE })
  providerType: ProviderType;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1234' })
  providerId: string;

  @ApiProperty({ example: 'EgyptAir' })
  providerName: string;

  @ApiProperty({ example: true })
  isActive: boolean;
}

export class ModeratorResponseDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a2222' })
  id: string;

  @ApiProperty({ example: 'airline.mod@passportly.local' })
  email: string;

  @ApiProperty({ example: 'EgyptAir' })
  firstName: string;

  @ApiProperty({ example: 'Moderator' })
  lastName: string;

  @ApiPropertyOptional({ example: '+201001234567' })
  phone?: string;

  @ApiProperty({
    enum: [Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR],
    example: Role.AIRLINE_MODERATOR,
  })
  role: Role;

  @ApiProperty({ enum: AccountStatus, example: AccountStatus.ACTIVE })
  status: AccountStatus;

  @ApiProperty({ example: true })
  isEmailVerified: boolean;

  @ApiProperty({ example: false })
  mustChangePassword: boolean;

  @ApiProperty({ type: ModeratorAssignmentSummaryDto })
  assignment: ModeratorAssignmentSummaryDto;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}
