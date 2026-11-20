import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { NotificationType } from '../../../common/enums';

const NOTIFICATION_SORT_FIELDS = [
  'createdAt',
  'readAt',
  'isRead',
  'type',
] as const;

export class ListNotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'When true, returns only unread notifications',
    example: true,
  })
  @IsOptional()
  @Transform(
    ({
      obj,
      key,
      value,
    }: {
      obj?: Record<string, unknown>;
      key: string;
      value: unknown;
    }) => {
      const raw = obj && key in obj ? obj[key] : value;
      if (raw === 'true' || raw === true) return true;
      if (raw === 'false' || raw === false) return false;
      return raw;
    },
  )
  @IsBoolean({ message: 'unreadOnly must be a boolean' })
  unreadOnly?: boolean;

  @ApiPropertyOptional({
    enum: NotificationType,
    description: 'Filter notifications by notification type',
  })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @ApiPropertyOptional({
    enum: NOTIFICATION_SORT_FIELDS,
    default: 'createdAt',
    description: 'Field to sort notifications by',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_SORT_FIELDS)
  override sortBy?: (typeof NOTIFICATION_SORT_FIELDS)[number] = 'createdAt';
}
