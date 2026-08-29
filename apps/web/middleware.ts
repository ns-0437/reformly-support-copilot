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
export function middleware(request: NextRequest) {
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
    if (user === expectedUser && pass === expectedPass) {
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
