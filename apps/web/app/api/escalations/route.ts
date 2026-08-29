import { NextResponse } from 'next/server';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

function backendAuthHeader(): string {
  const user = process.env.ADMIN_USERNAME ?? '';
  const pass = process.env.ADMIN_PASSWORD ?? '';
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

/**
 * Runs server-side only — the backend's admin credentials are attached here
 * and never sent to the browser. The client only ever needs to authenticate
 * to this Next.js app (via middleware.ts), not directly to the API.
 */
export async function GET() {
  const res = await fetch(`${API_BASE}/escalations`, {
    headers: { Authorization: backendAuthHeader() },
    cache: 'no-store',
  });
  const body = await res.text();
  return new NextResponse(body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
