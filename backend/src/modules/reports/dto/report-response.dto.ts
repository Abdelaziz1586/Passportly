import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportStatus, ReportTargetType } from '../../../common/enums';

export class ReportResponseDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a5555' })
  id: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1111' })
  reporter: string;

  @ApiProperty({ enum: ReportTargetType, example: ReportTargetType.BLOG_POST })
  targetType: ReportTargetType;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1234' })
  targetId: string;

  @ApiProperty({ example: 'Spam or misleading travel advertisement' })
  reason: string;

  @ApiPropertyOptional({
    example: 'Contains repeated promotional links in the post body.',
  })
  details?: string;

  @ApiProperty({ enum: ReportStatus, example: ReportStatus.PENDING })
  status: ReportStatus;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}
