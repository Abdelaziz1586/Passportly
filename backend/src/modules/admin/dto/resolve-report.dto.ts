import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReportStatus, ReportTargetType } from '../../../common/enums';

const RESOLUTION_STATUSES = [
  ReportStatus.DISMISSED,
  ReportStatus.CONTENT_HIDDEN,
  ReportStatus.CONTENT_DELETED,
] as const;

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ResolveReportDto {
  @ApiProperty({
    enum: RESOLUTION_STATUSES,
    example: ReportStatus.CONTENT_HIDDEN,
    description: 'Resolution decision for the report',
  })
  @IsIn(RESOLUTION_STATUSES, {
    message: 'status must be DISMISSED, CONTENT_HIDDEN, or CONTENT_DELETED',
  })
  status:
    | ReportStatus.DISMISSED
    | ReportStatus.CONTENT_HIDDEN
    | ReportStatus.CONTENT_DELETED;

  @ApiPropertyOptional({
    example: 'Hidden for violating community guidelines.',
    maxLength: 1000,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(1000)
  resolutionNotes?: string;
}

export class ResolveReportResponseDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a5555' })
  id: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1111' })
  reporter: string;

  @ApiProperty({ enum: ReportTargetType, example: ReportTargetType.BLOG_POST })
  targetType: ReportTargetType;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1234' })
  targetId: string;

  @ApiProperty({ example: 'Spam' })
  reason: string;

  @ApiProperty({ enum: ReportStatus, example: ReportStatus.CONTENT_HIDDEN })
  status: ReportStatus;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a0001' })
  reviewedBy: string;

  @ApiProperty()
  reviewedAt: Date;

  @ApiPropertyOptional()
  resolutionNotes?: string;
}
