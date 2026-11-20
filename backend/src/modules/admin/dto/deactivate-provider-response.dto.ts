import { ApiProperty } from '@nestjs/swagger';
import { ProviderType } from '../../../common/enums';

export class DeactivateProviderResponseDto {
  @ApiProperty({ example: 'Provider deactivated successfully' })
  message: string;

  @ApiProperty({ example: '673c1f2a9c4b2d001f8a1234' })
  id: string;

  @ApiProperty({ enum: ProviderType, example: ProviderType.AIRLINE })
  type: ProviderType;

  @ApiProperty({ example: 'EgyptAir' })
  name: string;

  @ApiProperty({ example: false })
  isActive: boolean;

  @ApiProperty()
  deactivatedAt: Date;

  @ApiProperty({ example: 1 })
  moderatorsNotified: number;

  @ApiProperty({ example: 3 })
  travelersNotified: number;
}
