'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface Escalation {
  id: string;
  reason: string;
  confidence: number | null;
  draftResponse: string;
  createdAt: string;
  conversation: {
    customer: { email: string; name: string };
    messages: { role: string; content: string }[];
  };
}

export default function EscalationsPage() {
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const data = await apiFetch<Escalation[]>('/escalations');
    setEscalations(data);
  }

  useEffect(() => {
    load();
  }, []);

  async function resolve(id: string, action: 'approve' | 'edit' | 'reject') {
    setBusyId(id);
    try {
      await apiFetch(`/escalations/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          finalResponse: action === 'edit' ? drafts[id] : undefined,
          reviewedBy: 'founder-demo@reformly.com',
        }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Escalation queue</h1>
      <p className="text-sm text-slate-500">
        Turns the agent routed to a human — low confidence, a failed tool call, or a high-risk action
        like pausing a subscription.
      </p>

      {escalations.length === 0 && <p className="text-slate-400 text-sm">Nothing pending.</p>}

      <div className="space-y-4">
        {escalations.map((esc) => (
          <div key={esc.id} className="border rounded bg-white p-4 space-y-3">
            <div className="flex justify-between text-sm text-slate-500">
              <span>{esc.conversation.customer.email}</span>
              <span>
                reason: <span className="font-medium text-slate-700">{esc.reason}</span>
                {esc.confidence !== null && ` · confidence ${(esc.confidence * 100).toFixed(0)}%`}
              </span>
            </div>

            <div className="text-sm bg-slate-50 rounded p-2 max-h-32 overflow-y-auto space-y-1">
              {esc.conversation.messages.slice(-4).map((m, i) => (
                <div key={i}>
                  <span className="text-slate-400">{m.role}:</span> {m.content}
                </div>
              ))}
            </div>

            <div>
              <label className="text-xs text-slate-500">AI draft response (editable)</label>
              <textarea
                className="w-full border rounded p-2 text-sm"
                rows={3}
                defaultValue={esc.draftResponse}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [esc.id]: e.target.value }))}
              />
            </div>

            <div className="flex gap-2">
              <button
                disabled={busyId === esc.id}
                onClick={() => resolve(esc.id, 'approve')}
                className="bg-emerald-600 text-white text-sm rounded px-3 py-1.5 disabled:opacity-50"
              >
                Approve as-is
              </button>
              <button
                disabled={busyId === esc.id}
                onClick={() => resolve(esc.id, 'edit')}
                className="bg-slate-900 text-white text-sm rounded px-3 py-1.5 disabled:opacity-50"
              >
                Send edited
              </button>
              <button
                disabled={busyId === esc.id}
                onClick={() => resolve(esc.id, 'reject')}
                className="bg-red-600 text-white text-sm rounded px-3 py-1.5 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
