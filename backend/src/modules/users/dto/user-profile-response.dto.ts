import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountStatus, Role } from '../../../common/enums';

export class UserProfileResponseDto {
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

  @ApiPropertyOptional({ example: 'https://cdn.example.com/avatar.png' })
  avatarUrl?: string;

  @ApiPropertyOptional({ example: 'Frequent traveler' })
  bio?: string;

  @ApiPropertyOptional({ example: 'EG' })
  nationality?: string;

  @ApiProperty({ example: 'EGP' })
  preferredCurrency: string;

  @ApiProperty({ enum: Role, example: Role.REGISTERED_USER })
  role: Role;

  @ApiProperty({ enum: AccountStatus, example: AccountStatus.ACTIVE })
  status: AccountStatus;

  @ApiProperty({ example: true })
  isEmailVerified: boolean;

  @ApiProperty({ example: false })
  mustChangePassword: boolean;

  @ApiPropertyOptional()
  lastLoginAt?: Date;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}
