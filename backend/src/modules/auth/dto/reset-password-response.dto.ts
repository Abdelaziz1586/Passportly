import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordResponseDto {
  @ApiProperty({
    example:
      'Password reset successfully. Please log in with your new password.',
  })
  message: string;
}
