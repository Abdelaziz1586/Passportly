import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PostStatus } from '../../../common/enums';

export const MY_POST_SORT_FIELDS = [
  'updatedAt',
  'createdAt',
  'publishedAt',
  'likesCount',
  'commentsCount',
  'title',
] as const;

export class ListMyPostsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: PostStatus,
    description: 'Filter current user posts by status (DRAFT or PUBLISHED)',
  })
  @IsOptional()
  @IsEnum(PostStatus, {
    message: 'status must be either DRAFT or PUBLISHED',
  })
  status?: PostStatus;

  @ApiPropertyOptional({
    enum: MY_POST_SORT_FIELDS,
    default: 'updatedAt',
    description: 'Field to sort user blog posts by',
  })
  @IsOptional()
  @IsIn(MY_POST_SORT_FIELDS)
  override sortBy?: (typeof MY_POST_SORT_FIELDS)[number] = 'updatedAt';
}
