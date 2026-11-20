import { ApiProperty } from '@nestjs/swagger';
import { ProviderType } from '../../../common/enums';

export class ReactivateProviderResponseDto {
  @ApiProperty({ example: 'Airline reactivated successfully' })
  message: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1234' })
  id: string;

  @ApiProperty({ enum: ProviderType, example: ProviderType.AIRLINE })
  type: ProviderType;

  @ApiProperty({ example: 'EgyptAir' })
  name: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: 1 })
  moderatorsNotified: number;
}
