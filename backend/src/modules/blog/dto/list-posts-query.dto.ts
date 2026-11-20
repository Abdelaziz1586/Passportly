import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const POST_SORT_FIELDS = [
  'publishedAt',
  'createdAt',
  'updatedAt',
  'likesCount',
  'commentsCount',
  'title',
] as const;

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ListPostsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Keyword search across post title, content, excerpt, and tags',
    example: 'cairo',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter published posts by tag name or slug',
    example: 'travel-tips',
    maxLength: 50,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(50)
  tag?: string;

  @ApiPropertyOptional({
    description: 'Filter published posts by author user ID',
    example: '673c1f2a9c4b2d001f8a1111',
  })
  @IsOptional()
  @IsMongoId({ message: 'author must be a valid MongoDB ObjectId' })
  author?: string;

  @ApiPropertyOptional({
    enum: POST_SORT_FIELDS,
    default: 'publishedAt',
    description: 'Field to sort blog posts by',
  })
  @IsOptional()
  @IsIn(POST_SORT_FIELDS)
  override sortBy?: (typeof POST_SORT_FIELDS)[number] = 'publishedAt';
}
