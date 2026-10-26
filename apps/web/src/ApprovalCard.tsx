import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { api } from './api';
import { formatCountdown } from './conversations';
import Markdown from './Markdown';
import type { ApprovalRequest } from './types';

export default function ApprovalCard({ request, onResolved, notify }: {
  request: ApprovalRequest;
  onResolved: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const titleId = useId();
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState(false);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const expired = request.expiresAt <= now;
  const countdown = formatCountdown(request.expiresAt, now);
  const args = request.args && typeof request.args === 'object' && !Array.isArray(request.args) ? request.args as Record<string, unknown> : {};
  const skill = request.toolName === 'save_skill';
  const writeContent = request.toolName === 'write_file' && typeof args.content === 'string' ? args.content : undefined;
  async function decide(decision: 'allow' | 'deny', remember = false) {
    if (busy || resolved || expired) return;
    if (remember && ['shell', 'self-modify'].includes(request.category) && !window.confirm(`Always allow ${request.category} for ${request.botName}? Future actions in this category will run without asking. You can change this in Bots → Approval policy.`)) return;
    setBusy(true);
    try {
      const result = await api<{ ok: boolean }>(`/api/approvals/${encodeURIComponent(request.id)}`, 'POST', { decision, by: 'web', ...(remember ? { remember: true } : {}) });
      setResolved(true);
      notify(!result.ok ? 'This request has already been resolved or expired.' : skill ? decision === 'allow' ? 'Skill approved.' : 'Skill suggestion dismissed.' : decision === 'deny' ? 'Action denied.' : remember ? `Always allowing ${request.category} for ${request.botName}.` : 'Action allowed.');
      await onResolved();
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget || event.repeat || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'a' && key !== 'd') return;
    event.preventDefault();
    void decide(key === 'a' ? 'allow' : 'deny');
  }
  return <article className={`approval-card stack${skill ? ' skill-suggestion' : ''}`} tabIndex={0} aria-labelledby={titleId} onKeyDown={keyDown}>
    <div className="toolbar"><strong>{request.botName} <span className="badge">{request.category}</span></strong><span className={request.expiresAt - now < 30000 ? 'error' : 'muted'} role="timer">{countdown}{!expired && ' remaining'}</span></div>
    <div><p className="eyebrow">{skill ? 'Suggested skill' : 'Approval needed'}</p><h3 id={titleId}>{skill && typeof args.name === 'string' ? args.name : request.summary}</h3></div>
    {skill ? <>
      <p>{typeof args.description === 'string' ? args.description : request.summary}</p>
      {typeof args.body === 'string' && <div className="skill-preview"><Markdown text={args.body} notify={notify} /></div>}
    </> : <details><summary>Details</summary><pre>{JSON.stringify(writeContent === undefined ? request.args : { ...args, content: undefined }, null, 2)}</pre>{writeContent !== undefined && <><strong>File content</strong><pre>{writeContent}</pre></>}</details>}
    <small className="muted">{request.channel} · {request.chatKey}</small>
    <div className="row approval-actions">
      <button className="primary" disabled={busy || expired || resolved} onClick={() => void decide('allow')}>{skill ? 'Save skill' : 'Allow'}</button>
      {!skill && <button disabled={busy || expired || resolved} onClick={() => void decide('allow', true)}>Always allow {request.category} for {request.botName}</button>}
      <button className="danger" disabled={busy || expired || resolved} onClick={() => void decide('deny')}>{skill ? 'Not now' : 'Deny'}</button>
    </div>
    <small className="muted">{busy ? 'Saving decision…' : resolved ? 'Decision recorded.' : expired ? 'Expired requests are denied.' : `Focus this card, then press A to ${skill ? 'save' : 'allow'} or D to ${skill ? 'dismiss' : 'deny'}.`}</small>
  </article>;
}
