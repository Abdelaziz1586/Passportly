import { ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { IsIn, ValidateIf } from 'class-validator';
import { BookingStatus } from '../../common/enums';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class BookingsQuery extends PickType(PaginationQueryDto, [
  'page',
  'limit',
]) {
  @ApiPropertyOptional()
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn([BookingStatus.CONFIRMED, BookingStatus.CANCELLED])
  status?: BookingStatus;
}
