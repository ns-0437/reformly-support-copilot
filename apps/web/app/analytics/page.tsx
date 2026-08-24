'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface Summary {
  totalConversations: number;
  escalationRate: number;
  escalationsByStatus: { status: string; count: number }[];
  llmUsage: { totalCalls: number; totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number };
  toolReliability: { tool: string; success: boolean; count: number }[];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    apiFetch<Summary>('/analytics/summary').then(setSummary).catch(() => setSummary(null));
  }, []);

  if (!summary) return <p className="text-slate-400 text-sm">Loading...</p>;

  const toolMap = new Map<string, { success: number; failure: number }>();
  for (const row of summary.toolReliability) {
    const entry = toolMap.get(row.tool) ?? { success: 0, failure: 0 };
    if (row.success) entry.success += row.count;
    else entry.failure += row.count;
    toolMap.set(row.tool, entry);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Analytics</h1>

      <div className="grid grid-cols-2 gap-4">
        <Stat label="Conversations" value={String(summary.totalConversations)} />
        <Stat label="Escalation rate" value={`${(summary.escalationRate * 100).toFixed(0)}%`} />
        <Stat label="LLM calls" value={String(summary.llmUsage.totalCalls)} />
        <Stat label="Estimated LLM cost" value={`$${summary.llmUsage.totalCostUsd.toFixed(4)}`} />
      </div>

      <div className="border rounded bg-white p-4">
        <h2 className="font-medium mb-2 text-sm">Tool reliability</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1">Tool</th>
              <th>Success</th>
              <th>Failure</th>
              <th>Success rate</th>
            </tr>
          </thead>
          <tbody>
            {[...toolMap.entries()].map(([tool, stats]) => {
              const total = stats.success + stats.failure;
              return (
                <tr key={tool} className="border-t">
                  <td className="py-1">{tool}</td>
                  <td>{stats.success}</td>
                  <td>{stats.failure}</td>
                  <td>{total === 0 ? '-' : `${((stats.success / total) * 100).toFixed(0)}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="border rounded bg-white p-4">
        <h2 className="font-medium mb-2 text-sm">Escalations by status</h2>
        <ul className="text-sm space-y-1">
          {summary.escalationsByStatus.map((e) => (
            <li key={e.status} className="flex justify-between">
              <span>{e.status}</span>
              <span>{e.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
