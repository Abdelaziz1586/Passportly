import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class ForgotPasswordDto {
  @ApiProperty({ example: 'traveler@example.com' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @MaxLength(255)
  email: string;
}
