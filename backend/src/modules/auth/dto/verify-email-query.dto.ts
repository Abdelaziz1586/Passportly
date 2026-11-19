import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class VerifyEmailQueryDto {
  @ApiPropertyOptional({
    description: 'Email verification token sent to the user',
    example: 'a1b2c3d4e5f6...',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'emailVerificationToken cannot be empty' })
  @MaxLength(256)
  emailVerificationToken?: string;

  @ApiPropertyOptional({
    description: 'Alias for emailVerificationToken query parameter',
    example: 'a1b2c3d4e5f6...',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'token cannot be empty' })
  @MaxLength(256)
  token?: string;
}
