import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { AccountStatus, ProviderType, Role } from '../../../common/enums';

const ACCOUNT_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'email',
  'firstName',
  'lastName',
  'role',
  'status',
  'lastLoginAt',
] as const;

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ListAccountsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Role, description: 'Filter by account role' })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({
    enum: AccountStatus,
    description: 'Filter by account status',
  })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @ApiPropertyOptional({
    description: 'Search by email, first name, or last name',
    example: 'traveler',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: ACCOUNT_SORT_FIELDS,
    default: 'createdAt',
    description: 'Field to sort accounts by',
  })
  @IsOptional()
  @IsIn(ACCOUNT_SORT_FIELDS)
  override sortBy?: (typeof ACCOUNT_SORT_FIELDS)[number] = 'createdAt';
}

export class AccountAssignmentInfoDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a9999' })
  id: string;

  @ApiProperty({ enum: ProviderType, example: ProviderType.AIRLINE })
  providerType: ProviderType;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1234' })
  providerId: string;

  @ApiPropertyOptional({ example: 'EgyptAir' })
  providerName?: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiPropertyOptional({ example: true })
  providerIsActive?: boolean;
}

export class AdminAccountItemDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1111' })
  id: string;

  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ example: 'Youssef' })
  firstName: string;

  @ApiProperty({ example: 'Sherif' })
  lastName: string;

  @ApiPropertyOptional()
  phone?: string;

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

  @ApiPropertyOptional({ type: AccountAssignmentInfoDto, nullable: true })
  assignment?: AccountAssignmentInfoDto | null;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}

export class PaginatedAccountsResponseDto {
  @ApiProperty({ type: [AdminAccountItemDto] })
  data: AdminAccountItemDto[];

  @ApiProperty({ example: 12 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}
