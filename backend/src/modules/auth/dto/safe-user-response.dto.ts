import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountStatus, Role } from '../../../common/enums';

export class SafeUserResponseDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1234' })
  id: string;

  @ApiProperty({ example: 'traveler@example.com' })
  email: string;

  @ApiProperty({ example: 'Abdelaziz' })
  firstName: string;

  @ApiProperty({ example: 'Mohamed' })
  lastName: string;

  @ApiPropertyOptional({ example: '+201001234567' })
  phone?: string;

  @ApiPropertyOptional()
  avatarUrl?: string;

  @ApiPropertyOptional()
  bio?: string;

  @ApiPropertyOptional({ example: 'EG' })
  nationality?: string;

  @ApiProperty({ example: 'USD' })
  preferredCurrency: string;

  @ApiProperty({ enum: Role, example: Role.REGISTERED_USER })
  role: Role;

  @ApiProperty({ enum: AccountStatus, example: AccountStatus.ACTIVE })
  status: AccountStatus;

  @ApiProperty({ example: false })
  isEmailVerified: boolean;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}
