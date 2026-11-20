import { ApiProperty } from '@nestjs/swagger';
import { AccountStatus } from '../../../common/enums';

export class DeactivateAccountResponseDto {
  @ApiProperty({ example: 'Account deactivated successfully' })
  message: string;

  @ApiProperty({
    enum: AccountStatus,
    example: AccountStatus.DEACTIVATED,
  })
  status: AccountStatus;

  @ApiProperty({ example: '2026-11-19T18:15:00.000Z' })
  deactivatedAt: Date;
}
