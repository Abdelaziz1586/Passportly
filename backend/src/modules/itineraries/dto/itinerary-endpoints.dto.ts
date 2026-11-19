import { ApiPropertyOptional } from '@nestjs/swagger';

import { Transform } from 'class-transformer';

import { IsEnum, IsOptional, IsString } from 'class-validator';

import { ItineraryVisibility } from '../../../common/enums';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ListItinerariesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ItineraryVisibility })
  @IsOptional()
  @IsEnum(ItineraryVisibility)
  visibility?: ItineraryVisibility;

  @ApiPropertyOptional({
    description: 'Search itinerary titles and descriptions',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  search?: string;
}
