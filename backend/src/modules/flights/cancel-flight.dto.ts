import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsString, Matches } from 'class-validator';

export class FlightCancel {
  @ApiProperty()
  @Transform(
    ({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key],
  )
  @Equals(true)
  confirmed!: boolean;

  @ApiProperty()
  @IsString()
  @Matches(/\S/)
  reason!: string;
}
