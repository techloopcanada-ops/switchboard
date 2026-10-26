import { useCallback, useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api } from '../api';
import { newId } from '../id';
import { applyChatEvent, conversationKey, type LiveRun } from '../chat-state';
import type { Bot, Message, ServerMessage, SessionRow } from '../types';

function Markdown({ text }: { text: string }) {
  const html = DOMPurify.sanitize(marked.parse(text, { async: false }), { USE_PROFILES: { html: true }, FORBID_TAGS: ['img', 'style', 'form', 'input', 'button'] });
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
function TranscriptMessage({ message }: { message: Message }) {
  const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
  const body = <>{content.map((block, index) => block.type === 'text'
    ? message.role === 'assistant' ? <Markdown key={index} text={block.text ?? ''} /> : <div className="plain-text" key={index}>{block.text}</div>
    : block.type === 'toolCall' ? <details className="tool-chip" key={index}><summary>{block.name}</summary><pre>{JSON.stringify(block.arguments, null, 2)}</pre></details> : null)}</>;
  if (message.role === 'toolResult') return <details className="tool-result"><summary>Tool result · {message.toolName ?? 'tool'}</summary>{body}</details>;
  return <article className={`message ${message.role}`}><div className="eyebrow">{message.role === 'user' ? 'You' : 'Assistant'}</div>{body}
    {message.errorMessage && <p className="error">{message.errorMessage}</p>}
    {message.usage && <small className="muted">${message.usage.cost.total.toFixed(5)} · {message.usage.input.toLocaleString()} input / {message.usage.output.toLocaleString()} output tokens</small>}
  </article>;
}
export default function Chat({ bots, selectedBot, onBot, connected, send, notify }: {
  bots: Bot[]; selectedBot: string; onBot: (id: string) => void; connected: boolean;
  send: (message: unknown) => void; notify: (message: string) => void;
}) {
  const botId = bots.some(bot => bot.id === selectedBot) ? selectedBot : bots[0]?.id ?? '';
  const [chatKey, setChatKey] = useState(() => `web:${newId()}`);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [runs, setRuns] = useState<Record<string, LiveRun>>({});
  const [pending, setPending] = useState<Record<string, string>>({});
  const pendingRequests = useRef(new Map<string, { key: string; text: string }>());
  const current = useRef({ botId, chatKey }); current.current = { botId, chatKey };
  const refreshId = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const key = conversationKey(botId, chatKey);
  const run = runs[key];
  const busy = run?.active || Boolean(pending[key]);
  const refresh = useCallback(async () => {
    if (!botId) return;
    const id = ++refreshId.current;
    setLoading(true); setLoadError('');
    try {
      const [list, history] = await Promise.all([
        api<SessionRow[]>(`/api/sessions/list?bot=${encodeURIComponent(botId)}`),
        api<{ messages: Message[] }>(`/api/sessions?bot=${encodeURIComponent(botId)}&chat=${encodeURIComponent(chatKey)}`),
      ]);
      if (id !== refreshId.current) return;
      setSessions(list); setMessages(history.messages);
    } catch (error) { if (id === refreshId.current) setLoadError(String(error)); }
    finally { if (id === refreshId.current) setLoading(false); }
  }, [botId, chatKey]);
  useEffect(() => { setMessages([]); void refresh(); return () => { refreshId.current++; }; }, [refresh]);
  useEffect(() => { if (connected) void refresh(); }, [connected, refresh]);
  useEffect(() => {
    function receive(event: Event) {
      const message = (event as CustomEvent<ServerMessage>).detail;
      if (message.type === 'chat') {
        const update = message.event;
        setRuns(previous => applyChatEvent(previous, update));
        if (update.type === 'start') {
          // Keep the pending prompt visible until the persisted transcript is refreshed.
          return;
        }
        if (update.type === 'done' || update.type === 'error') void refresh();
      } else if (message.type === 'chat_result' || message.type === 'error') {
        const request = message.requestId && pendingRequests.current.get(message.requestId);
        if (request) {
          setPending(previous => { const next = { ...previous }; delete next[request.key]; return next; });
          pendingRequests.current.delete(message.requestId!);
          if (message.type === 'error') notify(message.message);
          else if (message.result.error) notify(message.result.error);
          if ((message.type === 'error' || message.result.error) && request.key === conversationKey(current.current.botId, current.current.chatKey)) setText(draft => draft || request.text);
          void refresh();
        }
      } else if (message.type === 'abort_result' && !message.ok) notify('No active run to stop. It may have already finished.');
    }
    window.addEventListener('switchboard:message', receive);
    return () => window.removeEventListener('switchboard:message', receive);
  }, [refresh, notify]);
  useEffect(() => {
    if (!connected) {
      const request = [...pendingRequests.current.values()].find(request => request.key === conversationKey(current.current.botId, current.current.chatKey));
      if (request) setText(draft => draft || request.text);
      setPending({}); pendingRequests.current.clear();
      setRuns(previous => Object.fromEntries(Object.entries(previous).map(([id, run]) => [id, { ...run, active: false, interrupted: run.active || run.interrupted, error: run.active ? 'Connection interrupted. The server may still be running; refresh before sending again.' : run.error }])));
    }
  }, [connected]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages, run?.text]);
  function submit() {
    if (!text.trim() || !botId || busy || !connected) return;
    const id = newId();
    try {
      send({ type: 'chat', id, botId, chatKey, text: text.trim() });
      pendingRequests.current.set(id, { key, text: text.trim() });
      setPending(previous => ({ ...previous, [key]: text.trim() })); setText('');
      setRuns(previous => { const next = { ...previous }; delete next[key]; return next; });
    } catch (error) { notify(String(error)); }
  }
  async function reset() {
    if (!confirm('Reset this conversation? Its saved messages will be deleted.')) return;
    try {
      await api('/api/sessions/reset', 'POST', { botId, chatKey });
      setRuns(previous => { const next = { ...previous }; delete next[key]; return next; }); await refresh();
    } catch (error) { notify(String(error)); }
  }
  return <div className="chat-layout">
    <aside className="conversations card"><label>Talk to<select value={botId} onChange={event => { onBot(event.target.value); setChatKey(`web:${newId()}`); }}>{bots.map(bot => <option key={bot.id} value={bot.id}>{bot.emoji} {bot.name}</option>)}</select></label>
      <button className="primary" onClick={() => { setChatKey(`web:${newId()}`); setText(''); }}>＋ New conversation</button>
      <p className="eyebrow">Recent conversations</p>
      <div className="conversation-list">{sessions.length ? sessions.map(session => <button aria-pressed={session.chatKey === chatKey} key={session.id} onClick={() => setChatKey(session.chatKey)}>{session.title || 'Untitled conversation'}<small>{session.channel} · {new Date(session.updatedAt).toLocaleDateString()}</small></button>) : <p className="muted">Your conversations will appear here.</p>}</div>
    </aside>
    <section className="chat-panel card"><div className="toolbar"><div><strong>{bots.find(bot => bot.id === botId)?.name ?? 'Choose a bot'}</strong><div className="muted small">A workspace for your next idea.</div></div><div className="row"><button onClick={() => void refresh()} disabled={loading}>Refresh</button><button onClick={() => void reset()} disabled={!botId || busy || loading || !!loadError}>Reset</button></div></div>
      <div className="transcript" aria-label="Conversation">
        {loading && <p role="status" className="muted">Loading conversation…</p>}
        {loadError && <p role="alert" className="error">{loadError}</p>}
        {!loading && !messages.length && !pending[key] && !run?.error && <div className="empty"><span className="empty-mark">↗</span><h2>What shall we work on?</h2><p>Ask a question, explore an idea, or give your bot a task.<br/>Risky tools wait for your approval.</p></div>}
        {messages.map((message, index) => <TranscriptMessage message={message} key={index} />)}
        {pending[key] && <article className="message user"><div className="eyebrow">You</div><div className="plain-text">{pending[key]}</div></article>}
        {run?.active && <article className="message assistant" aria-live="polite"><div className="eyebrow">Working</div><Markdown text={run.text || 'Thinking…'} />{run.tools.map(tool => <details key={tool.id} className="tool-chip"><summary>{tool.name} {tool.output === undefined ? '…' : tool.isError ? '· failed' : '✓'}</summary><pre>{tool.output ?? 'Waiting for tool or approval…'}</pre></details>)}</article>}
        {run?.error && <p className="error" role="alert">{run.error}</p>}
        {run?.costUsd !== undefined && <p className="muted small">Last run: ${run.costUsd.toFixed(5)} · {run.inputTokens?.toLocaleString()} input / {run.outputTokens?.toLocaleString()} output tokens</p>}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={event => { event.preventDefault(); submit(); }}><label className="sr-only" htmlFor="chat-message">Message</label><textarea id="chat-message" rows={3} placeholder="Message your bot…" value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} />
        <div className="toolbar"><small className="muted">Enter to send · Shift + Enter for a new line</small><div className="row">{run?.sessionId && (run.active || run.interrupted) && <button type="button" onClick={() => { try { send({ type: 'abort', sessionId: run.sessionId }); } catch (error) { notify(String(error)); } }} disabled={!connected}>Stop</button>}<button className="primary" disabled={!text.trim() || busy || !connected || !botId || loading || !!loadError}>Send ↗</button></div></div>
      </form>
    </section>
  </div>;
}

