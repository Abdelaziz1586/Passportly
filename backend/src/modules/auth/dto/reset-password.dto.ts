import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ResetPasswordDto {
  @ApiPropertyOptional({
    description: 'Password reset token sent to the user email',
    example: 'a1b2c3d4e5f6...',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'passwordResetToken cannot be empty' })
  @MaxLength(256)
  passwordResetToken?: string;

  @ApiPropertyOptional({
    description: 'Alias for passwordResetToken',
    example: 'a1b2c3d4e5f6...',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'token cannot be empty' })
  @MaxLength(256)
  token?: string;

  @ApiProperty({
    example: 'NewStrongPass123!',
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
  newPassword: string;
}
