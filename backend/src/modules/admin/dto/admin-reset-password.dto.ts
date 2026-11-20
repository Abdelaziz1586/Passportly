import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class AdminResetPasswordDto {
  @ApiProperty({
    example: 'TempPass123!',
    minLength: 8,
    maxLength: 128,
    description:
      'Temporary password with at least one uppercase letter, one lowercase letter, one number, and one special character',
  })
  @IsString()
  @MinLength(8, {
    message: 'temporaryPassword must be at least 8 characters long',
  })
  @MaxLength(128, {
    message: 'temporaryPassword must not exceed 128 characters',
  })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).+$/, {
    message:
      'temporaryPassword must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  })
  temporaryPassword: string;
}

export class AdminResetPasswordResponseDto {
  @ApiProperty({ example: 'Temporary password set successfully' })
  message: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1234' })
  userId: string;

  @ApiProperty({ example: true })
  mustChangePassword: boolean;

  @ApiProperty({ example: 2 })
  sessionsRevoked: number;
}
