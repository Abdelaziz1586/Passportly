import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCommentDto {
  @ApiProperty({
    example: 'Great travel tips! Thanks for sharing.',
    minLength: 1,
    maxLength: 2000,
  })
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'Comment content is required' })
  @MinLength(1, { message: 'Comment content must not be empty' })
  @MaxLength(2000, {
    message: 'Comment content must not exceed 2000 characters',
  })
  content: string;
}
