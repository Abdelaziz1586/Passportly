import { PartialType } from '@nestjs/swagger';
import { AirlineCreate } from './create-airline.dto';

export class AirlineUpdate extends PartialType(AirlineCreate, {
  skipNullProperties: false,
}) {}
