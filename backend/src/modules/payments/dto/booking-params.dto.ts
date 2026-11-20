import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { BookingType } from '../../../common/enums';

/** Path parameters of the /bookings/:type/:id/... endpoints. */
export class BookingParamsDto {
  @ApiProperty({
    enum: BookingType,
    description: 'Kind of booking: flight or hotel',
    example: BookingType.FLIGHT,
  })
  @IsEnum(BookingType)
  type: BookingType;

  @ApiProperty({
    description: 'Booking id',
    example: '665f1c2e8a1b2c3d4e5f6a7b',
  })
  @IsMongoId()
  id: string;
}
