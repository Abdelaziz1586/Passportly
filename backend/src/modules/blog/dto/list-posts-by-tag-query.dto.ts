import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const TAG_POST_SORT_FIELDS = [
  'publishedAt',
  'createdAt',
  'updatedAt',
  'likesCount',
  'commentsCount',
  'title',
] as const;

export class ListPostsByTagQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: TAG_POST_SORT_FIELDS,
    default: 'publishedAt',
    description: 'Field to sort tagged blog posts by',
  })
  @IsOptional()
  @IsIn(TAG_POST_SORT_FIELDS)
  override sortBy?: (typeof TAG_POST_SORT_FIELDS)[number] = 'publishedAt';
}
