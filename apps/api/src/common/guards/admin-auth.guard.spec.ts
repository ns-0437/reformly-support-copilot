import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminAuthGuard } from './admin-auth.guard';

function makeContext(authHeader?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: authHeader } }),
    }),
  } as unknown as ExecutionContext;
}

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

describe('AdminAuthGuard', () => {
  function makeGuard(username?: string, password?: string) {
    const config = {
      get: (key: string) => ({ 'admin.username': username, 'admin.password': password })[key],
    } as unknown as ConfigService;
    return new AdminAuthGuard(config);
  }

  it('rejects when admin credentials are not configured at all', () => {
    const guard = makeGuard(undefined, undefined);
    expect(() => guard.canActivate(makeContext(basicAuthHeader('anyone', 'anything')))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a request with no Authorization header', () => {
    const guard = makeGuard('founder', 'secret123');
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(UnauthorizedException);
  });

  it('rejects the wrong password', () => {
    const guard = makeGuard('founder', 'secret123');
    expect(() => guard.canActivate(makeContext(basicAuthHeader('founder', 'wrong')))).toThrow(
      UnauthorizedException,
    );
  });

  it('accepts the correct username and password', () => {
    const guard = makeGuard('founder', 'secret123');
    expect(guard.canActivate(makeContext(basicAuthHeader('founder', 'secret123')))).toBe(true);
  });
});
