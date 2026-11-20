import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { AccountStatus, Role } from '../../../common/enums';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class SuspendAccountDto {
  @ApiPropertyOptional({
    example: 'Violation of community guidelines',
    maxLength: 500,
    description: 'Reason for suspending the account',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'reason cannot be empty if provided' })
  @MaxLength(500)
  reason?: string;
}

export class AccountStatusChangeResponseDto {
  @ApiProperty({ example: 'Account suspended successfully' })
  message: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1234' })
  id: string;

  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ enum: Role, example: Role.REGISTERED_USER })
  role: Role;

  @ApiProperty({ enum: AccountStatus, example: AccountStatus.SUSPENDED })
  status: AccountStatus;

  @ApiPropertyOptional()
  suspendedAt?: Date;

  @ApiPropertyOptional()
  suspendedReason?: string;

  @ApiProperty({ example: 2 })
  sessionsRevoked: number;
}
