import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const normalizeUpper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class RegisterDto {
  @ApiProperty({ example: 'traveler@example.com' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @MaxLength(255)
  email: string;

  @ApiProperty({
    example: 'StrongPass123!',
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

  @ApiProperty({ example: 'Abdelaziz', maxLength: 100 })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'First name is required' })
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Mohamed', maxLength: 100 })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'Last name is required' })
  @MaxLength(100)
  lastName: string;

  @ApiPropertyOptional({ example: '+201001234567', maxLength: 30 })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ example: 'EG', maxLength: 64 })
  @IsOptional()
  @Transform(normalizeUpper)
  @IsString()
  @MaxLength(64)
  nationality?: string;

  @ApiPropertyOptional({
    example: 'USD',
    default: 'USD',
    minLength: 3,
    maxLength: 3,
  })
  @IsOptional()
  @Transform(normalizeUpper)
  @IsString()
  @Length(3, 3, {
    message: 'preferredCurrency must be a 3-letter ISO currency code',
  })
  @Matches(/^[A-Z]{3}$/, {
    message: 'preferredCurrency must be a 3-letter ISO currency code',
  })
  preferredCurrency?: string;
}
