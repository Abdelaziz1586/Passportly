import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class RefundParamsDto {
  @ApiProperty({
    description: 'Refund id',
    example: '665f1c2e8a1b2c3d4e5f6a7b',
  })
  @IsMongoId()
  id: string;
}
