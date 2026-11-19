import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PostStatus } from '../../../common/enums';

export class BlogMediaItemDto {
  @ApiPropertyOptional({ example: '673c1f2a9c4b2d001f8a2222' })
  id?: string;

  @ApiProperty({ example: '/uploads/blog-posts/sample.jpg' })
  url: string;

  @ApiProperty({ example: 'sample.jpg' })
  filename: string;

  @ApiProperty({ example: 'image/jpeg' })
  mimeType: string;

  @ApiProperty({ example: 102400 })
  sizeBytes: number;

  @ApiProperty()
  uploadedAt: Date;
}

export class BlogAuthorSummaryDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1111' })
  id: string;

  @ApiProperty({ example: 'Abdullah' })
  firstName: string;

  @ApiProperty({ example: 'Emam' })
  lastName: string;

  @ApiPropertyOptional({ example: '/uploads/avatars/avatar.jpg' })
  avatarUrl?: string;

  @ApiPropertyOptional({ example: 'Travel writer and photographer' })
  bio?: string;
}

export class BlogPostItemDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a3333' })
  id: string;

  @ApiProperty({ oneOf: [{ type: 'string' }] })
  author: BlogAuthorSummaryDto | string;

  @ApiProperty({ example: '7 Days in Cairo & Luxor: Complete Travel Guide' })
  title: string;

  @ApiPropertyOptional({
    example: '7-days-in-cairo-luxor-complete-travel-guide-a1b2c3',
  })
  slug?: string;

  @ApiProperty()
  content: string;

  @ApiPropertyOptional()
  excerpt?: string;

  @ApiProperty({ enum: PostStatus, example: PostStatus.PUBLISHED })
  status: PostStatus;

  @ApiProperty({ example: false })
  isHidden: boolean;

  @ApiProperty({ type: [String], example: ['egypt', 'travel-tips'] })
  tags: string[];

  @ApiProperty({ type: [String] })
  tagRefs: string[];

  @ApiProperty({ type: [BlogMediaItemDto] })
  images: BlogMediaItemDto[];

  @ApiProperty({ example: 0 })
  likesCount: number;

  @ApiProperty({ example: 0 })
  commentsCount: number;

  @ApiPropertyOptional({ nullable: true, example: null })
  attachedItinerary?: string | null;

  @ApiPropertyOptional()
  publishedAt?: Date;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}

export class DeleteBlogPostResponseDto {
  @ApiProperty({ example: 'Blog post deleted successfully' })
  message: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a3333' })
  id: string;
}
