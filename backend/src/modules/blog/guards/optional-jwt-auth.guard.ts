import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedUser } from '../../../common/interfaces/jwt-payload.interface';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  override handleRequest<TUser = AuthenticatedUser | undefined>(
    err: unknown,
    user: TUser,
  ): TUser {
    if (err || !user) {
      return undefined as TUser;
    }
    return user;
  }
}
