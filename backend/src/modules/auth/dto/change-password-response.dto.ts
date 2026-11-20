import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordResponseDto {
  @ApiProperty({ example: 'Password changed successfully' })
  message: string;

  @ApiProperty({ example: false })
  mustChangePassword: boolean;

  @ApiProperty({ example: 1 })
  revokedOtherSessionsCount: number;
}
