import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { createHash, timingSafeEqual } from 'crypto';

/** Constant-time string comparison — a plain `!==` leaks timing information proportional to the matching prefix length. */
function safeEqual(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * HTTP Basic Auth for the human-facing surfaces (escalation queue, analytics)
 * — these carry customer conversation content and let someone approve/reject
 * support decisions, and were sitting on a public URL with no auth at all
 * before this. Credentials come from ADMIN_USERNAME/ADMIN_PASSWORD; if
 * either is unset, every request is rejected rather than silently open.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expectedUser = this.config.get<string>('admin.username');
    const expectedPass = this.config.get<string>('admin.password');

    if (!expectedUser || !expectedPass) {
      throw new UnauthorizedException('Admin auth is not configured on this deployment');
    }

    const header = request.headers.authorization;
    if (!header?.startsWith('Basic ')) {
      throw new UnauthorizedException('Missing credentials');
    }

    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    const user = decoded.slice(0, separatorIndex);
    const pass = decoded.slice(separatorIndex + 1);

    if (!safeEqual(user, expectedUser) || !safeEqual(pass, expectedPass)) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return true;
  }
}
