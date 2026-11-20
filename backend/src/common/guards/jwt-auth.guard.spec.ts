import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard public and optional authentication', () => {
  const guard = new JwtAuthGuard(new Reflector());
  const makeContext = (publicRoute = false, optionalAuth = false) => {
    const handler = () => undefined;
    class Controller {}
    Reflect.defineMetadata(IS_PUBLIC_KEY, publicRoute, handler);
    Reflect.defineMetadata(OPTIONAL_AUTH_KEY, optionalAuth, handler);
    return {
      getHandler: () => handler,
      getClass: () => Controller,
    } as unknown as ExecutionContext;
  };

  it('bypasses authentication for an explicitly public route', () => {
    expect(guard.canActivate(makeContext(true))).toBe(true);
  });

  it('requires a valid user on protected routes', () => {
    expect(() =>
      guard.handleRequest(null, undefined, null, makeContext()),
    ).toThrow(UnauthorizedException);
  });

  it('preserves strategy rejection for revoked or suspended sessions on protected routes', () => {
    const error = new UnauthorizedException('Session revoked');
    expect(() =>
      guard.handleRequest(error, undefined, null, makeContext()),
    ).toThrow(error);
  });

  it('permits guest access on optional routes and preserves a validated identity', () => {
    const context = makeContext(true, true);
    expect(guard.handleRequest(null, undefined, null, context)).toBeUndefined();
    const user = { userId: 'authenticated-user' };
    expect(guard.handleRequest(null, user, null, context)).toBe(user);
  });

  it('does not reuse a rejected identity on optional routes', () => {
    expect(
      guard.handleRequest(
        new UnauthorizedException(),
        { userId: 'revoked-user' },
        null,
        makeContext(true, true),
      ),
    ).toBeUndefined();
  });
});
