import { ApiProperty } from '@nestjs/swagger';

export class DeleteContentResponseDto {
  @ApiProperty({ example: 'Content deleted successfully' })
  message: string;

  @ApiProperty({
    enum: ['blog_post', 'comment', 'itinerary', 'review'],
    example: 'blog_post',
  })
  type: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1234' })
  id: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1111' })
  ownerId: string;

  @ApiProperty({ example: 1 })
  resolvedPendingReports: number;
}
