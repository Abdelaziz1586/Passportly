import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ReportTargetType } from '../../../common/enums';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateReportDto {
  @ApiProperty({
    enum: ReportTargetType,
    example: ReportTargetType.BLOG_POST,
    description: 'Type of content being reported',
  })
  @IsEnum(ReportTargetType)
  targetType: ReportTargetType;

  @ApiProperty({
    example: '673c1f2a9c4b2d001f8a1234',
    description: 'MongoDB ObjectId of the reported content',
  })
  @IsMongoId({ message: 'targetId must be a valid MongoDB ObjectId' })
  targetId: string;

  @ApiProperty({
    example: 'Spam or misleading travel advertisement',
    maxLength: 200,
  })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'reason is required' })
  @MaxLength(200)
  reason: string;

  @ApiPropertyOptional({
    example: 'Contains repeated promotional links in the post body.',
    maxLength: 2000,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'details cannot be empty if provided' })
  @MaxLength(2000)
  details?: string;
}
