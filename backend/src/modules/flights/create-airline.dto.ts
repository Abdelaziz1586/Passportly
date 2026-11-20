import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class AirlineCreate {
  @ApiProperty()
  @IsString()
  @Matches(/\S/)
  name!: string;

  @ApiProperty()
  @Matches(/^[a-z0-9]{2}$/i)
  iataCode!: string;
}
