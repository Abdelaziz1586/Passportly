import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  AccountStatus,
  ReportStatus,
  ReportTargetType,
  Role,
} from '../../../common/enums';

const REPORT_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'status',
  'reviewedAt',
] as const;

export class ListReportsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ReportStatus,
    description: 'Filter reports by moderation status',
  })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional({
    enum: ReportTargetType,
    description: 'Filter reports by target content type',
  })
  @IsOptional()
  @IsEnum(ReportTargetType)
  targetType?: ReportTargetType;

  @ApiPropertyOptional({
    enum: REPORT_SORT_FIELDS,
    default: 'createdAt',
    description: 'Field to sort reports by',
  })
  @IsOptional()
  @IsIn(REPORT_SORT_FIELDS)
  override sortBy?: (typeof REPORT_SORT_FIELDS)[number] = 'createdAt';
}

export class ReportUserSummaryDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1111' })
  id: string;

  @ApiPropertyOptional({ example: 'Jane' })
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  lastName?: string;

  @ApiPropertyOptional({ example: 'jane@example.com' })
  email?: string;

  @ApiPropertyOptional({ enum: Role })
  role?: Role;

  @ApiPropertyOptional({ enum: AccountStatus })
  status?: AccountStatus;
}

export class AdminReportItemDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a5555' })
  id: string;

  @ApiProperty({ type: ReportUserSummaryDto })
  reporter: ReportUserSummaryDto | string;

  @ApiProperty({ enum: ReportTargetType, example: ReportTargetType.BLOG_POST })
  targetType: ReportTargetType;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1234' })
  targetId: string;

  @ApiProperty({ example: 'Spam or misleading links' })
  reason: string;

  @ApiPropertyOptional()
  details?: string;

  @ApiProperty({ enum: ReportStatus, example: ReportStatus.PENDING })
  status: ReportStatus;

  @ApiPropertyOptional({ type: ReportUserSummaryDto, nullable: true })
  reviewedBy?: ReportUserSummaryDto | string | null;

  @ApiPropertyOptional()
  reviewedAt?: Date;

  @ApiPropertyOptional()
  resolutionNotes?: string;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}

export class PaginatedReportsResponseDto {
  @ApiProperty({ type: [AdminReportItemDto] })
  data: AdminReportItemDto[];

  @ApiProperty({ example: 5 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}
