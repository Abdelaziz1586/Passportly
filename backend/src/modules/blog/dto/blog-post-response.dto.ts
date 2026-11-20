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

export class PostLikeResponseDto {
  @ApiProperty({ example: 'Post liked successfully' })
  message: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a3333' })
  postId: string;

  @ApiProperty({ example: true })
  liked: boolean;

  @ApiProperty({ example: 1 })
  likesCount: number;
}

export class UploadPostImageResponseDto {
  @ApiProperty({ type: BlogMediaItemDto })
  image: BlogMediaItemDto;

  @ApiProperty({ type: [BlogMediaItemDto] })
  images: BlogMediaItemDto[];
}

export class PaginatedBlogPostsResponseDto {
  @ApiProperty({ type: [BlogPostItemDto] })
  data: BlogPostItemDto[];

  @ApiProperty({ example: 12 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class BlogCommentItemDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a4444' })
  id: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a3333' })
  post: string;

  @ApiProperty({ oneOf: [{ type: 'string' }] })
  author: BlogAuthorSummaryDto | string;

  @ApiProperty({ example: 'Great tips on visiting Luxor!' })
  content: string;

  @ApiProperty({ example: false })
  isHidden: boolean;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}

export class BlogPostDetailResponseDto extends BlogPostItemDto {
  @ApiProperty({ type: [BlogCommentItemDto] })
  comments: BlogCommentItemDto[];
}

export class DeleteCommentResponseDto {
  @ApiProperty({ example: 'Comment deleted successfully' })
  message: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a4444' })
  id: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a3333' })
  postId: string;
}

export class DeleteBlogPostResponseDto {
  @ApiProperty({ example: 'Blog post deleted successfully' })
  message: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a2222' })
  id: string;
}

export class DeletePostImageResponseDto {
  @ApiProperty({ example: 'Image deleted successfully' })
  message: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a3333' })
  postId: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a2222' })
  imageId: string;

  @ApiProperty({ type: [BlogMediaItemDto] })
  images: BlogMediaItemDto[];
}

export class BlogTagSummaryDto {
  @ApiPropertyOptional({ example: '673c1f2a9c4b2d001f8a5555' })
  id?: string;

  @ApiProperty({ example: 'travel tips' })
  name: string;

  @ApiProperty({ example: 'travel-tips' })
  slug: string;

  @ApiPropertyOptional({ example: 4 })
  usageCount?: number;
}

export class TagPostsResponseDto extends PaginatedBlogPostsResponseDto {
  @ApiProperty({ type: BlogTagSummaryDto })
  tag: BlogTagSummaryDto;
}
