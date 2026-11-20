import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export enum ETicketFormat {
  JSON = 'json',
  PDF = 'pdf',
}

export class ETicketQueryDto {
  @ApiPropertyOptional({
    enum: ETicketFormat,
    default: ETicketFormat.JSON,
    description:
      'json (default) returns the structured e-ticket; pdf downloads it as a PDF file',
  })
  @IsOptional()
  @IsEnum(ETicketFormat)
  format?: ETicketFormat = ETicketFormat.JSON;
}
