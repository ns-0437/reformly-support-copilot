import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Reformly Support Copilot',
  description: 'AI customer support copilot with reliability scoring and human-in-the-loop review',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 min-h-screen">
        <nav className="border-b bg-white px-6 py-3 flex gap-6 items-center">
          <span className="font-semibold">Reformly Support Copilot</span>
          <Link href="/" className="text-sm text-slate-600 hover:text-slate-900">
            Chat
          </Link>
          <Link href="/escalations" className="text-sm text-slate-600 hover:text-slate-900">
            Escalation queue
          </Link>
          <Link href="/analytics" className="text-sm text-slate-600 hover:text-slate-900">
            Analytics
          </Link>
        </nav>
        <main className="max-w-3xl mx-auto p-6">{children}</main>
      </body>
    </html>
  );
}
