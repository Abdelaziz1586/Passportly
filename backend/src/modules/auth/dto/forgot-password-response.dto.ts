import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordResponseDto {
  @ApiProperty({
    example:
      'If an active account exists with that email, a password reset link has been sent.',
  })
  message: string;
}
