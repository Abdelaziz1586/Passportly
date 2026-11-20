import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeUpper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Abdelaziz', maxLength: 100 })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'firstName cannot be empty' })
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Mohamed', maxLength: 100 })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'lastName cannot be empty' })
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ example: '+201001234567', maxLength: 30 })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/avatars/user.png',
    maxLength: 500,
    description:
      'Valid http(s) URL, /uploads/... path, or empty string to clear',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(500)
  @Matches(/^(|https?:\/\/\S+|\/uploads\/\S+)$/i, {
    message:
      'avatarUrl must be an http(s) URL, /uploads/ path, or empty string',
  })
  avatarUrl?: string;

  @ApiPropertyOptional({
    example: 'Avid traveler exploring Cairo, Tokyo, and London.',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(500)
  bio?: string;

  @ApiPropertyOptional({ example: 'EG', maxLength: 64 })
  @IsOptional()
  @Transform(normalizeUpper)
  @IsString()
  @MaxLength(64)
  nationality?: string;

  @ApiPropertyOptional({
    example: 'EGP',
    minLength: 3,
    maxLength: 3,
    description:
      '3-letter ISO currency code validated against seeded Countries.csv',
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
