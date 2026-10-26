import { useEffect, useState } from 'react';
import { api } from '../api';
import { LoadState, useResource } from '../resource';
import type { ApprovalRequest } from '../types';

interface Log { id: string; bot_id: string; tool: string; args: string; decision: string; decided_by: string; decided_at: number }
export default function Approvals({ approvals, refreshApprovals, notify }: { approvals: ApprovalRequest[]; refreshApprovals: () => Promise<void>; notify: (message: string) => void }) {
  const history = useResource<Log[]>('/api/approvals/log');
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string[]>([]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { void history.refresh(); }, [approvals, history.refresh]);
  async function decide(id: string, decision: 'allow' | 'deny') {
    setBusy(previous => [...previous, id]);
    try {
      const result = await api<{ ok: boolean }>(`/api/approvals/${id}`, 'POST', { decision, by: 'web' });
      notify(result.ok ? `Action ${decision === 'allow' ? 'allowed' : 'denied'}.` : 'This request has already been resolved or expired.');
      await refreshApprovals(); await history.refresh();
    } catch (error) { notify(String(error)); }
    finally { setBusy(previous => previous.filter(item => item !== id)); }
  }
  return <div className="stack"><div className="toolbar"><p className="muted">You decide what happens on your machine. Expired requests are denied.</p><button onClick={() => void refreshApprovals().catch(error => notify(String(error)))}>Refresh</button></div>
    {!approvals.length && <div className="card empty"><span className="empty-mark">✓</span><h2>All clear</h2><p>When a bot needs permission, its request appears here.</p></div>}
    {approvals.map(request => { const seconds = Math.max(0, Math.ceil((request.expiresAt - now) / 1000)); return <article className="card stack" key={request.id}>
      <div className="toolbar"><strong>{request.botName} <span className="badge">{request.category}</span></strong><span className={seconds < 30 ? 'error' : 'muted'}>{seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} remaining` : 'Expired · waiting for server'}</span></div>
      <h2>{request.summary}</h2><small className="muted">{request.channel} · {request.chatKey} · {request.toolName}</small>
      <details><summary>Review arguments</summary><pre>{JSON.stringify(request.args, null, 2)}</pre></details>
      <div className="row"><button className="primary" disabled={!seconds || busy.includes(request.id)} onClick={() => void decide(request.id, 'allow')}>Allow once</button><button className="danger" disabled={!seconds || busy.includes(request.id)} onClick={() => void decide(request.id, 'deny')}>Deny</button></div>
    </article>; })}
    <section className="card"><h2>Recent decisions</h2><LoadState loading={history.loading} error={history.error} retry={history.refresh} />
      {history.data?.length ? history.data.map(entry => <details className="history-entry" key={entry.id}><summary><span className="badge">{entry.decision}</span> {entry.bot_id} · {entry.tool}<small className="muted">{new Date(entry.decided_at).toLocaleString()} · {entry.decided_by}</small></summary><pre>{entry.args}</pre></details>) : !history.loading && <p className="muted">No decisions yet.</p>}
    </section></div>;
}
