import { useEffect } from 'react';
import ApprovalCard from '../ApprovalCard';
import { LoadState, useResource } from '../resource';
import type { ApprovalRequest } from '../types';

interface Log { id: string; bot_id: string; tool: string; args: string; decision: string; decided_by: string; decided_at: number }
export default function Approvals({ approvals, refreshApprovals, notify }: { approvals: ApprovalRequest[]; refreshApprovals: () => Promise<void>; notify: (message: string) => void }) {
  const history = useResource<Log[]>('/api/approvals/log');
  useEffect(() => { void history.refresh(); }, [approvals, history.refresh]);
  async function resolved() { await refreshApprovals(); await history.refresh(); }
  return <div className="stack"><div className="toolbar"><p className="muted">You decide what happens on your machine. Expired requests are denied.</p><button onClick={() => void refreshApprovals().catch(error => notify(String(error)))}>Refresh</button></div>
    {!approvals.length && <div className="card empty"><span className="empty-mark">✓</span><h2>All clear</h2><p>When a bot needs permission, its request appears here.</p></div>}
    {approvals.map(request => <ApprovalCard key={request.id} request={request} onResolved={resolved} notify={notify} />)}
    <section className="card"><h2>Recent decisions</h2><LoadState loading={history.loading} error={history.error} retry={history.refresh} />
      {history.data?.length ? history.data.map(entry => <details className="history-entry" key={entry.id}><summary><span className="badge">{entry.decision}</span> {entry.bot_id} · {entry.tool}<small className="muted">{new Date(entry.decided_at).toLocaleString()} · {entry.decided_by}</small></summary><pre>{entry.args}</pre></details>) : !history.loading && <p className="muted">No decisions yet.</p>}
    </section></div>;
}
