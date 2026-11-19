import { applyDecorators, SetMetadata } from '@nestjs/common';
import { Public } from './public.decorator';

export const OPTIONAL_AUTH_KEY = 'optionalAuth';

export const OptionalAuth = () =>
  applyDecorators(Public(), SetMetadata(OPTIONAL_AUTH_KEY, true));
