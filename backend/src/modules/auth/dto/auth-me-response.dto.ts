import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProviderType } from '../../../common/enums';
import { SafeUserResponseDto } from './safe-user-response.dto';

export class AuthMeResponseDto extends SafeUserResponseDto {
  @ApiProperty({ example: false })
  mustChangePassword: boolean;

  @ApiPropertyOptional()
  lastLoginAt?: Date;

  @ApiPropertyOptional({ example: '673c1f2a9c4b2d001f8a9999' })
  assignedProviderId?: string;

  @ApiPropertyOptional({ enum: ProviderType, example: ProviderType.AIRLINE })
  assignedProviderType?: 'airline' | 'hotel';
}
