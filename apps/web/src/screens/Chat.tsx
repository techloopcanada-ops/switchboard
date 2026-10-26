import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api';
import { newId } from '../id';
import { applyChatEvent, conversationKey, type LiveRun } from '../chat-state';
import { loadCurrent, saveCurrent, loadDraft, saveDraft, clearDraft, listDrafts, filterUnsentDrafts, type CurrentConversation } from '../conversations';
import { filterCommands, type CommandOption } from '../commands';
import { shouldStickToBottom } from '../transcript-state';
import Composer from '../Composer';
import ConversationList from '../ConversationList';
import Transcript from '../Transcript';
import ApprovalCard from '../ApprovalCard';
import type { ApprovalRequest, Bot, Message, ServerMessage, SessionRow, Workflow } from '../types';

interface History { messages: Message[]; session: SessionRow | null; loading: boolean; error: string }
interface Pending { current: CurrentConversation; key: string; original: string; text: string; accepted: boolean; base: Message[] }
const emptyHistory: History = { messages: [], session: null, loading: false, error: '' };
const keyOf = (current: CurrentConversation) => conversationKey(current.botId, current.chatKey);
function browserStorage() { try { return window.localStorage; } catch { return null; } }

export default function Chat({ bots, defaultBot, requestedBot, connected, send, notify, approvals, refreshApprovals, visible }: {
  bots: Bot[]; defaultBot: string; requestedBot?: { id: string; nonce: number }; connected: boolean;
  send: (message: unknown) => void; notify: (message: string) => void; approvals: ApprovalRequest[];
  refreshApprovals: () => Promise<void>; visible: boolean;
}) {
  const [storage] = useState(browserStorage);
  const [initial] = useState(() => {
    const fresh = { botId: defaultBot, chatKey: `web:${newId()}` };
    const current = loadCurrent(storage, fresh);
    return { current, restored: current.chatKey !== fresh.chatKey };
  });
  const [current, setCurrent] = useState(initial.current);
  const currentRef = useRef(current); currentRef.current = current;
  const [drafts, setDrafts] = useState<Record<string, string>>(() => ({ ...Object.fromEntries(listDrafts(storage).map(draft => [keyOf(draft), draft.text])), [keyOf(current)]: loadDraft(storage, current) }));
  const draftsRef = useRef(drafts);
  const [histories, setHistories] = useState<Record<string, History>>({});
  const historiesRef = useRef(histories);
  const historySequence = useRef(new Map<string, number>());
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const listSequence = useRef(0);
  const [runs, setRuns] = useState<Record<string, LiveRun>>({});
  const runsRef = useRef(runs);
  const runTargets = useRef(new Map<string, CurrentConversation>());
  const pending = useRef(new Map<string, Pending>());
  const [, updatePending] = useState(0);
  const [failures, setFailures] = useState<Record<string, { message: string; text: string }>>({});
  const [notes, setNotes] = useState<Record<string, { id: string; text: string }[]>>({});
  const [workflowCommands, setWorkflowCommands] = useState<CommandOption[]>([]);
  const deleted = useRef(new Set<string>());
  const [paneOpen, setPaneOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const paneButton = useRef<HTMLButtonElement>(null);
  const [renameTitle, setRenameTitle] = useState<string>();
  const [learning, setLearning] = useState(false);
  const [focusVersion, setFocusVersion] = useState(0);
  const [jumpVisible, setJumpVisible] = useState(false);
  const sticking = useRef(true);
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const lastRequest = useRef<number | undefined>(undefined);
  const key = keyOf(current);
  const history = histories[key] ?? emptyHistory;
  const draft = drafts[key] ?? '';
  const run = runs[key];
  const request = [...pending.current.values()].find(request => request.key === key);
  const busy = Boolean(run?.active || request);
  const bot = bots.find(bot => bot.id === current.botId);
  const currentApprovals = approvals.filter(request => request.chatKey === current.chatKey && request.botId === current.botId);
  const unsentDrafts = filterUnsentDrafts(Object.entries(drafts).filter(([key]) => !deleted.current.has(key) && !histories[key]?.messages.length).map(([key, text]) => { const [botId, chatKey] = JSON.parse(key) as [string, string]; return { botId, chatKey, text }; }), listLoading || listError ? undefined : sessions);
  const modalPane = paneOpen && mobilePane && visible;
  const closePane = useCallback(() => {
    setPaneOpen(false);
    requestAnimationFrame(() => paneButton.current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const changed = () => { setMobilePane(media.matches); if (!media.matches) setPaneOpen(false); };
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => { if (!visible) setPaneOpen(false); }, [visible]);
  useEffect(() => {
    if (!modalPane) return;
    const pane = document.getElementById('conversation-pane');
    const items = () => [...(pane?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])') ?? [])].filter(item => {
      const closed = item.closest('details:not([open])');
      return item.getClientRects().length > 0 && getComputedStyle(item).visibility === 'visible' && !item.closest('[inert]') && (!closed || item.tagName === 'SUMMARY' && item.parentElement === closed);
    });
    // Wait for the drawer's visibility transition to make its controls focusable.
    let focusFrame = requestAnimationFrame(() => { focusFrame = requestAnimationFrame(() => items()[0]?.focus({ preventScroll: true })); });
    const keyboard = (event: KeyboardEvent) => {
      if (pane?.closest('[inert]')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePane(); return; }
      if (event.key !== 'Tab') return;
      const links = items(); const first = links[0]; const last = links.at(-1);
      if (!pane?.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { cancelAnimationFrame(focusFrame); document.removeEventListener('keydown', keyboard); };
  }, [modalPane, closePane]);

  const putHistory = useCallback((key: string, value: History) => {
    historiesRef.current = { ...historiesRef.current, [key]: value };
    if (mounted.current) setHistories(historiesRef.current);
  }, []);
  const putDraft = useCallback((target: CurrentConversation, text: string) => {
    const key = keyOf(target);
    draftsRef.current = { ...draftsRef.current, [key]: text };
    saveDraft(storage, target, text);
    setDrafts(draftsRef.current);
  }, [storage]);
  const putRuns = useCallback((next: Record<string, LiveRun>) => { runsRef.current = next; setRuns(next); }, []);
  const refreshList = useCallback(async () => {
    const sequence = ++listSequence.current;
    try {
      const rows = await api<SessionRow[]>('/api/sessions/list');
      if (mounted.current && sequence === listSequence.current) { setSessions(rows); setListError(''); }
    } catch (error) { if (mounted.current && sequence === listSequence.current) setListError(String(error)); }
    finally { if (mounted.current && sequence === listSequence.current) setListLoading(false); }
  }, []);
  const refreshHistory = useCallback(async (target: CurrentConversation) => {
    const key = keyOf(target);
    if (deleted.current.has(key)) return;
    const sequence = (historySequence.current.get(key) ?? 0) + 1;
    historySequence.current.set(key, sequence);
    const old = historiesRef.current[key] ?? emptyHistory;
    if (!old.messages.length) putHistory(key, { ...old, loading: true, error: '' });
    try {
      const result = await api<{ session: SessionRow | null; messages: Message[] }>(`/api/sessions?bot=${encodeURIComponent(target.botId)}&chat=${encodeURIComponent(target.chatKey)}`);
      if (historySequence.current.get(key) === sequence && !deleted.current.has(key)) putHistory(key, { ...result, loading: false, error: '' });
    } catch (error) {
      if (historySequence.current.get(key) === sequence) putHistory(key, { ...(historiesRef.current[key] ?? old), loading: false, error: String(error) });
    }
  }, [putHistory]);
  const openConversation = useCallback((target: CurrentConversation, load: boolean) => {
    currentRef.current = target;
    saveCurrent(storage, target);
    if (!(keyOf(target) in draftsRef.current)) putDraft(target, loadDraft(storage, target));
    if (!load) putHistory(keyOf(target), emptyHistory);
    setCurrent(target); setPaneOpen(false); setRenameTitle(undefined); setFocusVersion(value => value + 1);
    sticking.current = true; setJumpVisible(false);
    if (load) void refreshHistory(target);
  }, [storage, putDraft, putHistory, refreshHistory]);
  const newChat = useCallback((botId = currentRef.current.botId) => {
    openConversation({ botId, chatKey: `web:${newId()}` }, false);
  }, [openConversation]);
  const acknowledge = useCallback((request: Pending) => {
    if (request.accepted) return;
    request.accepted = true;
    if (draftsRef.current[request.key] === request.original) putDraft(request.current, '');
    updatePending(value => value + 1);
  }, [putDraft]);
  const failRequest = useCallback((request: Pending, message: string) => {
    if (deleted.current.has(request.key)) return;
    if (!draftsRef.current[request.key]) putDraft(request.current, request.original);
    setFailures(previous => ({ ...previous, [request.key]: { message, text: request.original } }));
    if (keyOf(currentRef.current) === request.key) setFocusVersion(value => value + 1);
  }, [putDraft]);

  useEffect(() => {
    mounted.current = true;
    saveCurrent(storage, initial.current);
    void refreshList();
    if (initial.restored) void refreshHistory(initial.current);
    void api<{ workflows: Workflow[] }>('/api/workflows').then(result => {
      if (mounted.current) setWorkflowCommands(result.workflows.flatMap(workflow => workflow.trigger.type === 'command' ? [{ id: workflow.trigger.command, label: `/${workflow.trigger.command}`, description: workflow.description || workflow.name, insert: `/${workflow.trigger.command}` }] : []));
    }).catch(error => notify(`Command list unavailable: ${String(error)}`));
    return () => { mounted.current = false; };
  }, [storage, initial, refreshList, refreshHistory, notify]);
  useEffect(() => {
    if (requestedBot && lastRequest.current !== requestedBot.nonce) { lastRequest.current = requestedBot.nonce; newChat(requestedBot.id); }
  }, [requestedBot, newChat]);
  useEffect(() => {
    if (!visible) return;
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'o' && !event.isComposing) { event.preventDefault(); newChat(); }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [visible, newChat]);
  useEffect(() => {
    function receive(event: Event) {
      const message = (event as CustomEvent<ServerMessage>).detail;
      if (message.type === 'chat') {
        const update = message.event;
        if (update.type === 'start') {
          const target = { botId: update.botId, chatKey: update.chatKey };
          if (deleted.current.has(keyOf(target))) return;
          runTargets.current.set(update.runId, target);
          const request = [...pending.current.values()].find(request => request.key === keyOf(target) && !request.accepted);
          if (request) acknowledge(request);
        }
        const target = runTargets.current.get(update.runId);
        if (target && deleted.current.has(keyOf(target))) return;
        putRuns(applyChatEvent(runsRef.current, update));
        if (update.type === 'tool_start' || update.type === 'tool_end') { if (target) void refreshHistory(target); void refreshList(); }
        if (update.type === 'done' || update.type === 'error') {
          void refreshList();
          // A reload can miss start; the next terminal event still refreshes the visible transcript.
          void refreshHistory(target ?? currentRef.current);
          if (target && keyOf(target) === keyOf(currentRef.current)) setFocusVersion(value => value + 1);
          if (update.type === 'error' && target) {
            const request = [...pending.current.values()].find(request => request.key === keyOf(target));
            if (request) failRequest(request, update.message);
          }
        }
      } else if (message.type === 'command_result' || message.type === 'chat_result' || message.type === 'error') {
        const request = message.requestId ? pending.current.get(message.requestId) : undefined;
        if (!request) return;
        pending.current.delete(message.requestId!); updatePending(value => value + 1);
        if (deleted.current.has(request.key)) return;
        if (message.type === 'command_result') {
          acknowledge(request);
          let destination = request.current;
          if ((message.command.switchBot || message.command.newConversation) && request.key === keyOf(currentRef.current)) {
            destination = { botId: message.command.switchBot ?? request.current.botId, chatKey: `web:${newId()}` };
            openConversation(destination, false);
          }
          setNotes(previous => ({ ...previous, [keyOf(destination)]: [...(previous[keyOf(destination)] ?? []), { id: message.requestId, text: message.command.reply }] }));
          setFocusVersion(value => value + 1);
        } else {
          const error = message.type === 'error' ? message.message : message.result.error;
          if (error) failRequest(request, error); else acknowledge(request);
          void refreshHistory(request.current); void refreshList();
          if (request.key === keyOf(currentRef.current)) setFocusVersion(value => value + 1);
        }
      } else if (message.type === 'abort_result' && !message.ok) notify('That run has already finished.');
    }
    window.addEventListener('switchboard:message', receive);
    return () => window.removeEventListener('switchboard:message', receive);
  }, [acknowledge, failRequest, notify, openConversation, putRuns, refreshHistory, refreshList]);
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (!connected && wasConnected.current) {
      for (const request of pending.current.values()) failRequest(request, 'Connection interrupted. The server may still be working. Check the transcript before retrying.');
      pending.current.clear(); updatePending(value => value + 1);
      putRuns(Object.fromEntries(Object.entries(runsRef.current).map(([key, run]) => [key, { ...run, active: false, interrupted: run.active || run.interrupted }])));
    } else if (connected && !wasConnected.current) {
      void refreshList();
      if (initial.restored || historiesRef.current[keyOf(currentRef.current)]?.session || runsRef.current[keyOf(currentRef.current)]) void refreshHistory(currentRef.current);
    }
    wasConnected.current = connected;
  }, [connected, initial.restored, failRequest, putRuns, refreshHistory, refreshList]);
  useLayoutEffect(() => {
    if (!visible || !scroll.current) return;
    if (sticking.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    else setJumpVisible(true);
  }, [history.messages, run, notes, approvals, current, visible]);
  useEffect(() => {
    const element = content.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { if (sticking.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function submit() {
    if (!draft.trim() || busy || !connected || !bot || history.loading || history.error) return;
    const id = newId();
    const request: Pending = { current, key, original: draft, text: draft.trim(), accepted: false, base: history.messages };
    pending.current.set(id, request); updatePending(value => value + 1);
    setFailures(previous => { const next = { ...previous }; delete next[key]; return next; });
    const next = { ...runsRef.current }; delete next[key]; putRuns(next);
    sticking.current = true; setJumpVisible(false);
    try { send({ type: 'chat', id, botId: current.botId, chatKey: current.chatKey, text: request.text }); }
    catch (error) { pending.current.delete(id); updatePending(value => value + 1); failRequest(request, String(error)); }
  }
  async function rename(session: SessionRow, title: string) {
    try {
      const result = await api<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(session.id)}`, 'PUT', { title: title.trim() });
      if (!result.ok) throw new Error('This conversation no longer exists.');
      const history = historiesRef.current[keyOf(session)];
      if (history?.session) putHistory(keyOf(session), { ...history, session: { ...history.session, title: title.trim() } });
      setRenameTitle(undefined); await refreshList();
    } catch (error) { notify(String(error)); }
  }
  async function remove(session: SessionRow) {
    if (!confirm(`Delete “${session.title || 'Untitled conversation'}”? Its messages will be permanently removed.`)) return;
    try {
      await api(`/api/sessions/${encodeURIComponent(session.id)}`, 'DELETE');
      const key = keyOf(session); deleted.current.add(key); clearDraft(storage, session);
      for (const [id, request] of pending.current) if (request.key === key) pending.current.delete(id);
      updatePending(value => value + 1);
      if (keyOf(currentRef.current) === key) newChat(session.botId);
      await refreshList();
    } catch (error) { notify(String(error)); }
  }
  async function clear() {
    if (busy || !history.session || !confirm('Clear all messages in this conversation? This cannot be undone.')) return;
    const target = current;
    try {
      await api('/api/sessions/reset', 'POST', { botId: target.botId, chatKey: target.chatKey });
      const next = { ...runsRef.current }; delete next[keyOf(target)]; putRuns(next);
      setNotes(previous => ({ ...previous, [keyOf(target)]: [] }));
      setFailures(previous => { const next = { ...previous }; delete next[keyOf(target)]; return next; });
      await refreshHistory(target); await refreshList();
    } catch (error) { notify(String(error)); }
  }
  function retry(text: string) { putDraft(current, text); setFocusVersion(value => value + 1); }
  async function learn() {
    setLearning(true);
    try { const result = await api<{ message: string }>('/api/learn', 'POST', { botId: current.botId, chatKey: current.chatKey }); notify(result.message); await refreshApprovals(); }
    catch (error) { notify(String(error)); }
    finally { setLearning(false); }
  }
  let shown = history.messages;
  if (run?.active) {
    if (request?.accepted) shown = [...request.base, { role: 'user', content: request.text }];
    else { const lastUser = shown.map(message => message.role).lastIndexOf('user'); shown = shown.slice(0, lastUser + 1); }
  }
  const failure = failures[key];
  return <div className={`chat-layout${paneOpen ? ' conversations-open' : ''}`}>
    {paneOpen && <button className="conversation-backdrop" onClick={closePane} aria-label="Close conversations" tabIndex={-1} />}
    <ConversationList sessions={sessions} drafts={unsentDrafts} onOpenDraft={target => openConversation(target, false)} bots={bots} current={current} loading={listLoading} error={listError} onSelect={session => openConversation({ botId: session.botId, chatKey: session.chatKey }, true)} onNew={() => newChat()} onRename={rename} onDelete={remove} onClose={closePane} onRetry={() => void refreshList()} modal={modalPane} />
    <section className="chat-panel" aria-label="Chat" inert={modalPane ? true : undefined}><header className="chat-header"><button ref={paneButton} className="show-conversations" aria-expanded={paneOpen} aria-controls="conversation-pane" onClick={() => setPaneOpen(true)}>☰ <span>Chats</span></button><div className="chat-heading"><label className="bot-picker"><span className="sr-only">Bot</span><select value={current.botId} onChange={event => newChat(event.target.value)}>{!bot && <option value={current.botId}>{current.botId} · unavailable</option>}{bots.map(bot => <option key={bot.id} value={bot.id}>{bot.emoji} {bot.name} · {bot.model.provider}/{bot.model.id}</option>)}</select></label>
      {renameTitle !== undefined && history.session ? <form className="rename-form" onSubmit={event => { event.preventDefault(); void rename(history.session!, renameTitle); }}><label className="sr-only" htmlFor="header-title">Conversation title</label><input id="header-title" autoFocus required maxLength={80} value={renameTitle} onChange={event => setRenameTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setRenameTitle(undefined); }} /><button disabled={!renameTitle.trim()}>Save</button><button type="button" onClick={() => setRenameTitle(undefined)}>Cancel</button></form> : <button className="conversation-title" title={history.session ? 'Rename conversation' : undefined} disabled={!history.session} onClick={() => setRenameTitle(history.session?.title ?? '')}>{history.session?.title || 'New conversation'}</button>}
    </div><div className="chat-actions"><button disabled={!history.messages.length || learning || busy || !connected} onClick={() => void learn()}>{learning ? 'Reviewing…' : 'Learn from this chat'}</button><details className="chat-menu"><summary aria-label="Conversation options">⋯</summary><div className="row-actions"><button disabled={!history.session || busy} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void clear(); }}>Clear messages</button><button className="danger" disabled={!history.session} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); if (history.session) void remove(history.session); }}>Delete conversation</button></div></details></div></header>
      <div ref={scroll} className="transcript-scroll" aria-label="Conversation" onScroll={event => { sticking.current = shouldStickToBottom(event.currentTarget); setJumpVisible(!sticking.current); }}><div ref={content} className="transcript-content">
        {history.loading && <p role="status" className="muted">Loading conversation…</p>}
        {history.error && <div role="alert" className="inline-error">{history.error}<button onClick={() => void refreshHistory(current)}>Try again</button></div>}
        {!history.loading && !shown.length && !run?.active && !notes[key]?.length && !failure && <div className="empty"><span className="empty-mark">↗</span><h2>What would you like to do?</h2><p>Ask a question or give {bot?.name ?? 'your bot'} a task.<br/>Type / to see commands.</p></div>}
        <Transcript messages={shown} run={run && failure ? { ...run, error: undefined } : run} notify={notify} onRetry={retry} />
        {request && !request.accepted && <p className="pending-message" role="status">Sending… Your draft stays here until the server accepts it.</p>}
        {notes[key]?.map(note => <article className="command-note" key={note.id}><strong>Switchboard</strong><div className="plain-text">{note.text}</div></article>)}
        {failure && !shown.some(message => message.errorMessage === failure.message) && <div role="alert" className="inline-error"><p>{failure.message}</p><button onClick={() => retry(failure.text)}>Retry</button></div>}
        {currentApprovals.map(request => <ApprovalCard key={request.id} request={request} onResolved={refreshApprovals} notify={notify} />)}
      </div></div>
      {jumpVisible && <button className="jump-latest" onClick={() => { sticking.current = true; if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; setJumpVisible(false); }}>Jump to latest ↓</button>}
      <Composer value={draft} onChange={text => putDraft(current, text)} onSend={submit} onStop={run?.sessionId && (run.active || run.interrupted) ? () => { try { send({ type: 'abort', sessionId: run.sessionId }); } catch (error) { notify(String(error)); } } : undefined} busy={busy} connected={connected} canSend={Boolean(draft.trim() && !busy && connected && bot && !history.loading && !history.error)} options={filterCommands(draft, bots, workflowCommands)} focusVersion={focusVersion} visible={visible} />
    </section>
  </div>;
}
