'use client';

import { useState } from 'react';
import { apiFetch } from './lib/api';

interface ChatTurn {
  role: 'customer' | 'agent';
  content: string;
  confidence?: number;
  status?: 'answered' | 'escalated';
}

export default function ChatPage() {
  const [email, setEmail] = useState('jane.doe@example.com');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [message, setMessage] = useState('Whats the status of order RFM-10234?');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!message.trim()) return;
    setLoading(true);
    setError(null);
    setTurns((prev) => [...prev, { role: 'customer', content: message }]);

    try {
      const res = await apiFetch<{
        conversationId: string;
        status: 'answered' | 'escalated';
        message: string;
        confidence: number;
      }>('/chat/message', {
        method: 'POST',
        body: JSON.stringify({ customerEmail: email, conversationId, message }),
      });
      setConversationId(res.conversationId);
      setTurns((prev) => [
        ...prev,
        { role: 'agent', content: res.message, confidence: res.confidence, status: res.status },
      ]);
      setMessage('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Support chat</h1>
      <div className="flex gap-2 items-center text-sm">
        <label className="text-slate-500">Customer email</label>
        <input
          className="border rounded px-2 py-1 flex-1"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="border rounded bg-white p-4 space-y-3 min-h-[280px]">
        {turns.length === 0 && (
          <p className="text-slate-400 text-sm">
            Try: &quot;Whats the status of order RFM-10234?&quot;, &quot;I want a refund for RFM-10234, it arrived
            broken&quot;, or &quot;Can I pause my subscription?&quot;
          </p>
        )}
        {turns.map((turn, i) => (
          <div key={i} className={turn.role === 'customer' ? 'text-right' : 'text-left'}>
            <div
              className={`inline-block rounded-lg px-3 py-2 max-w-[85%] text-sm ${
                turn.role === 'customer' ? 'bg-slate-900 text-white' : 'bg-slate-100'
              }`}
            >
              {turn.content}
            </div>
            {turn.role === 'agent' && turn.confidence !== undefined && (
              <div className="text-xs text-slate-400 mt-1">
                confidence {(turn.confidence * 100).toFixed(0)}%
                {turn.status === 'escalated' && (
                  <span className="ml-2 text-amber-600 font-medium">held for human review</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex gap-2">
        <input
          className="border rounded px-3 py-2 flex-1"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Type a message..."
        />
        <button
          onClick={send}
          disabled={loading}
          className="bg-slate-900 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          {loading ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
