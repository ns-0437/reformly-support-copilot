import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

function backendAuthHeader(): string {
  const user = process.env.ADMIN_USERNAME ?? '';
  const pass = process.env.ADMIN_PASSWORD ?? '';
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.text();
  const res = await fetch(`${API_BASE}/escalations/${params.id}/resolve`, {
    method: 'POST',
    headers: { Authorization: backendAuthHeader(), 'Content-Type': 'application/json' },
    body,
  });
  const responseBody = await res.text();
  return new NextResponse(responseBody, { status: res.status, headers: { 'Content-Type': 'application/json' } });
}
