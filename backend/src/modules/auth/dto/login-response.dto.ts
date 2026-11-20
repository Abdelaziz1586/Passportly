import { ApiProperty } from '@nestjs/swagger';
import { SafeUserResponseDto } from './safe-user-response.dto';

export class LoginResponseDto {
  @ApiProperty({ example: 'Login successful' })
  message: string;

  @ApiProperty({ type: SafeUserResponseDto })
  user: SafeUserResponseDto;

  @ApiProperty({ example: false })
  mustChangePassword: boolean;
}
