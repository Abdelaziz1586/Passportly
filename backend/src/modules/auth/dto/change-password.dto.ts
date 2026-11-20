import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const parseOptionalBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldStrongPass123!' })
  @IsString()
  @IsNotEmpty({ message: 'Current password is required' })
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty({
    example: 'NewStrongPass456!',
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

  @ApiPropertyOptional({
    default: true,
    description:
      'Whether to revoke all other active sessions for this user while keeping the current session active',
  })
  @IsOptional()
  @Transform(parseOptionalBoolean)
  @IsBoolean()
  revokeOtherSessions?: boolean;
}
