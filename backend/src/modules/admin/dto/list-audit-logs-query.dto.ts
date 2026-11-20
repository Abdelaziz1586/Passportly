import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { Role } from '../../../common/enums';

const AUDIT_LOG_SORT_FIELDS = ['createdAt', 'action', 'targetType'] as const;

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

function parseDateBoundary(
  endOfDay: boolean,
): (params: {
  obj?: Record<string, unknown>;
  key: string;
  value: unknown;
}) => unknown {
  return ({ obj, key, value }) => {
    const raw = obj && key in obj ? obj[key] : value;
    if (raw === undefined || raw === null || raw === '') {
      return undefined;
    }
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
      const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
      return new Date(`${raw.trim()}${suffix}`);
    }
    if (raw instanceof Date) {
      return raw;
    }
    if (typeof raw === 'string' || typeof raw === 'number') {
      return new Date(raw);
    }
    return raw;
  };
}

export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: '673c1f2a9c4b2d001f8a0001',
    description: 'Filter by actor user ID',
  })
  @IsOptional()
  @IsMongoId({ message: 'actor must be a valid MongoDB ObjectId' })
  actor?: string;

  @ApiPropertyOptional({
    example: 'ACCOUNT_SUSPENDED',
    maxLength: 100,
    description: 'Filter by audit log action name',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({
    example: 'User',
    maxLength: 100,
    description: 'Filter by target entity type',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  targetType?: string;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'Inclusive start date (ISO date or timestamp) on createdAt',
  })
  @IsOptional()
  @Transform(parseDateBoundary(false))
  @IsDate({ message: 'fromDate must be a valid date' })
  fromDate?: Date;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'Inclusive end date (ISO date or timestamp) on createdAt',
  })
  @IsOptional()
  @Transform(parseDateBoundary(true))
  @IsDate({ message: 'toDate must be a valid date' })
  toDate?: Date;

  @ApiPropertyOptional({
    enum: AUDIT_LOG_SORT_FIELDS,
    default: 'createdAt',
    description: 'Field to sort audit logs by',
  })
  @IsOptional()
  @IsIn(AUDIT_LOG_SORT_FIELDS)
  override sortBy?: (typeof AUDIT_LOG_SORT_FIELDS)[number] = 'createdAt';
}

export class AuditLogActorSummaryDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a0001' })
  id: string;

  @ApiPropertyOptional({ example: 'Platform' })
  firstName?: string;

  @ApiPropertyOptional({ example: 'Administrator' })
  lastName?: string;

  @ApiPropertyOptional({ example: 'admin@travelplatform.local' })
  email?: string;

  @ApiPropertyOptional({ enum: Role })
  role?: Role;
}

export class AuditLogItemDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a7777' })
  id: string;

  @ApiPropertyOptional({ type: AuditLogActorSummaryDto, nullable: true })
  actor: AuditLogActorSummaryDto | string | null;

  @ApiPropertyOptional({ example: 'ADMIN' })
  actorRole?: string;

  @ApiProperty({ example: 'ACCOUNT_SUSPENDED' })
  action: string;

  @ApiProperty({ example: 'User' })
  targetType: string;

  @ApiPropertyOptional({ example: '673c1f2a9c4b2d001f8a1234' })
  targetId?: string;

  @ApiPropertyOptional()
  details?: Record<string, unknown>;

  @ApiPropertyOptional({ example: '127.0.0.1' })
  ipAddress?: string;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}

export class PaginatedAuditLogsResponseDto {
  @ApiProperty({ type: [AuditLogItemDto] })
  data: AuditLogItemDto[];

  @ApiProperty({ example: 15 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}
