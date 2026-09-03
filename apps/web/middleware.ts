import { NextRequest, NextResponse } from 'next/server';

/**
 * Gates the escalation queue and analytics pages (and their API proxy
 * routes) behind HTTP Basic Auth. These carry real customer conversation
 * content and let someone approve/reject support decisions — they were
 * sitting on a public Vercel URL with no auth at all before this.
 *
 * Runs BEFORE any client JS loads, so a browser hitting these paths gets its
 * native credential prompt on page load, not a broken fetch after the fact.
 */

/**
 * Constant-time comparison via SHA-256 digest — a plain `===` leaks timing
 * information proportional to the matching prefix length, which is exactly
 * what AdminAuthGuard on the backend already fixed once. This middleware
 * runs in the Edge runtime, which doesn't have Node's crypto.timingSafeEqual,
 * so it uses the Web Crypto API instead.
 */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([sha256(a), sha256(b)]);
  if (hashA.length !== hashB.length) return false;
  let diff = 0;
  for (let i = 0; i < hashA.length; i++) diff |= hashA[i] ^ hashB[i];
  return diff === 0;
}

async function sha256(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return new Uint8Array(digest);
}

export async function middleware(request: NextRequest) {
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedPass = process.env.ADMIN_PASSWORD;

  if (!expectedUser || !expectedPass) {
    return new NextResponse('Admin auth is not configured on this deployment', { status: 401 });
  }

  const header = request.headers.get('authorization');
  if (header?.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    const user = decoded.slice(0, separatorIndex);
    const pass = decoded.slice(separatorIndex + 1);
    const [userOk, passOk] = await Promise.all([safeEqual(user, expectedUser), safeEqual(pass, expectedPass)]);
    if (userOk && passOk) {
      return NextResponse.next();
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Reformly admin"' },
  });
}

export const config = {
  matcher: ['/escalations/:path*', '/analytics/:path*', '/api/escalations/:path*', '/api/analytics/:path*'],
};
