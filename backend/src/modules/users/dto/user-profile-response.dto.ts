import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountStatus, ProviderType, Role } from '../../../common/enums';

export class ModeratorAssignmentSummaryDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a9999' })
  id: string;

  @ApiProperty({ enum: ProviderType, example: ProviderType.AIRLINE })
  providerType: ProviderType;

  @ApiPropertyOptional({ example: '673c1f2a9c4b2d001f8a5555' })
  providerId?: string;

  @ApiPropertyOptional({ example: '673c1f2a9c4b2d001f8a5555' })
  airlineId?: string;

  @ApiPropertyOptional({ example: '673c1f2a9c4b2d001f8a6666' })
  hotelId?: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a0001' })
  assignedBy: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}

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

  @ApiPropertyOptional({ example: 'Frequent traveler and photographer' })
  bio?: string;

  @ApiPropertyOptional({ example: 'EG' })
  nationality?: string;

  @ApiProperty({ example: 'USD' })
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
  suspendedAt?: Date;

  @ApiPropertyOptional()
  suspendedReason?: string;

  @ApiPropertyOptional()
  deactivatedAt?: Date;

  @ApiPropertyOptional({
    type: ModeratorAssignmentSummaryDto,
    nullable: true,
    description: 'Active provider assignment when user is a moderator',
  })
  moderatorAssignment?: ModeratorAssignmentSummaryDto | null;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}
