import { ApiProperty } from '@nestjs/swagger';
import { AccountStatus, Role } from '../../../common/enums';

export class ReactivateAccountResponseDto {
  @ApiProperty({ example: 'Account reactivated successfully' })
  message: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1234' })
  id: string;

  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ enum: Role, example: Role.REGISTERED_USER })
  role: Role;

  @ApiProperty({ enum: AccountStatus, example: AccountStatus.ACTIVE })
  status: AccountStatus;

  @ApiProperty({ example: 0 })
  failedLoginAttempts: number;
}
