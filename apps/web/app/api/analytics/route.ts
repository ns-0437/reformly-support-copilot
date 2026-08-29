import { NextResponse } from 'next/server';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

function backendAuthHeader(): string {
  const user = process.env.ADMIN_USERNAME ?? '';
  const pass = process.env.ADMIN_PASSWORD ?? '';
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

export async function GET() {
  const res = await fetch(`${API_BASE}/analytics/summary`, {
    headers: { Authorization: backendAuthHeader() },
    cache: 'no-store',
  });
  const body = await res.text();
  return new NextResponse(body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
