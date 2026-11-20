import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PostStatus } from '../../../common/enums';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimStringArray = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? value.map((item: unknown): unknown =>
        typeof item === 'string' ? item.trim() : item,
      )
    : value;

export class UpdatePostDto {
  @ApiPropertyOptional({
    example: 'Updated Cairo & Luxor Travel Guide',
    minLength: 3,
    maxLength: 200,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'Title cannot be empty' })
  @MinLength(3, { message: 'Title must be at least 3 characters long' })
  @MaxLength(200, { message: 'Title must not exceed 200 characters' })
  title?: string;

  @ApiPropertyOptional({
    example: 'Updated detailed seven-day Egypt travel guide...',
    minLength: 10,
    maxLength: 50000,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'Content cannot be empty' })
  @MinLength(10, { message: 'Content must be at least 10 characters long' })
  @MaxLength(50000, { message: 'Content must not exceed 50000 characters' })
  content?: string;

  @ApiPropertyOptional({
    example: 'Updated excerpt summary.',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(500, { message: 'Excerpt must not exceed 500 characters' })
  excerpt?: string;

  @ApiPropertyOptional({
    enum: PostStatus,
    description: 'Post publication status (DRAFT or PUBLISHED)',
  })
  @IsOptional()
  @IsEnum(PostStatus, {
    message: 'status must be either DRAFT or PUBLISHED',
  })
  status?: PostStatus;

  @ApiPropertyOptional({
    type: [String],
    example: ['Egypt', 'Luxor', 'Budget Travel'],
    maxItems: 20,
  })
  @IsOptional()
  @Transform(trimStringArray)
  @IsArray()
  @ArrayMaxSize(20, { message: 'A post can have at most 20 tags' })
  @IsString({ each: true })
  @MaxLength(50, {
    each: true,
    message: 'Each tag must not exceed 50 characters',
  })
  tags?: string[];
}
