import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const AUTHOR_POST_SORT_FIELDS = [
  'publishedAt',
  'createdAt',
  'updatedAt',
  'likesCount',
  'commentsCount',
  'title',
] as const;

export class AuthorPostsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: AUTHOR_POST_SORT_FIELDS,
    default: 'publishedAt',
    description: 'Field to sort author published blog posts by',
  })
  @IsOptional()
  @IsIn(AUTHOR_POST_SORT_FIELDS)
  override sortBy?: (typeof AUTHOR_POST_SORT_FIELDS)[number] = 'publishedAt';
}
