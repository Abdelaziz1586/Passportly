import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '../../../common/enums';

export class NotificationItemDto {
  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1234' })
  id: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a9999' })
  recipient: string;

  @ApiProperty({ enum: NotificationType, example: NotificationType.SYSTEM })
  type: NotificationType;

  @ApiProperty({ example: 'Booking Confirmed' })
  title: string;

  @ApiProperty({ example: 'Your flight booking has been confirmed.' })
  message: string;

  @ApiPropertyOptional({ example: 'FlightBooking' })
  relatedEntityType?: string;

  @ApiPropertyOptional({ example: '673c1f2a9c4b2d001f8a5678' })
  relatedEntityId?: string;

  @ApiProperty({ example: true })
  isRead: boolean;

  @ApiPropertyOptional()
  readAt?: Date;

  @ApiPropertyOptional()
  createdAt?: Date;

  @ApiPropertyOptional()
  updatedAt?: Date;
}
