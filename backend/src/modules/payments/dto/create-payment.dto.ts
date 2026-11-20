import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { BookingType } from '../../../common/enums';

export class CreatePaymentDto {
  @ApiProperty({ enum: BookingType, example: BookingType.FLIGHT })
  @IsEnum(BookingType)
  bookingType: BookingType;

  @ApiProperty({
    description:
      'Id of the PENDING_PAYMENT booking to pay. The amount is always the booking total stored on the server.',
    example: '665f1c2e8a1b2c3d4e5f6a7b',
  })
  @IsMongoId()
  bookingId: string;
}
