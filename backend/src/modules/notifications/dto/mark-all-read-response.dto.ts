import { ApiProperty } from '@nestjs/swagger';

export class MarkAllNotificationsReadResponseDto {
  @ApiProperty({ example: 'All unread notifications marked as read' })
  message: string;

  @ApiProperty({ example: 4 })
  modifiedCount: number;

  @ApiProperty({ example: '2026-11-19T12:00:00.000Z' })
  readAt: Date;
}
