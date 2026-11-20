import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeCurrency = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateItineraryDto {
  @ApiProperty({ example: 'Summer in Japan' })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional({ example: 'A two-week trip across Japan' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'MongoDB IDs of countries from the reference-data API',
    example: ['673c1f2a9c4b2d001f8a1234'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  countries?: string[];

  @ApiProperty({ example: '2027-06-15' })
  @IsDateString({ strict: true })
  startDate: string;

  @ApiPropertyOptional({
    example: 'USD',
    default: 'USD',
    minLength: 3,
    maxLength: 3,
  })
  @IsOptional()
  @Transform(normalizeCurrency)
  @IsString()
  @Length(3, 3, {
    message: 'displayCurrency must be a 3-letter ISO currency code',
  })
  @Matches(/^[A-Z]{3}$/, {
    message: 'displayCurrency must be a 3-letter ISO currency code',
  })
  displayCurrency?: string;
}
