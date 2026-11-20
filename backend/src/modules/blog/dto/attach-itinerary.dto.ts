import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsMongoId, ValidateIf } from 'class-validator';

export class AttachItineraryDto {
  @ApiProperty({
    example: '673c1f2a9c4b2d001f8a5555',
    nullable: true,
    description:
      'Public itinerary MongoDB ObjectId to attach, or null to detach',
  })
  @IsDefined({
    message: 'itineraryId is required (provide an ObjectId or null to detach)',
  })
  @ValidateIf((_, value: unknown) => value !== null)
  @IsMongoId({
    message: 'itineraryId must be a valid MongoDB ObjectId or null',
  })
  itineraryId: string | null;
}
