import { useCallback, useEffect, useRef, useState } from 'react';
import { api, bootstrap, setToken } from './api';
import { connectSocket, type Socket } from './ws';
import { createApprovalSnapshots } from './approval-snapshots';
import type { ApprovalRequest, Bot, Config, ServerMessage } from './types';
import Chat from './screens/Chat';
import Approvals from './screens/Approvals';
import Bots from './screens/Bots';
import Workflows from './screens/Workflows';
import Skills from './screens/Skills';
import Memory from './screens/Memory';
import Settings from './screens/Settings';
import Pair from './screens/Pair';
import GetStarted from './screens/GetStarted';

const screens = [
  ['chat', 'Chat', '↗'], ['approvals', 'Approvals', '✓'], ['bots', 'Bots', '◈'],
  ['workflows', 'Workflows', '↻'], ['skills', 'Skills', '⌘'], ['memory', 'Memory', '≡'],
  ['settings', 'Settings', '⚙'], ['pair', 'Pair', '▦'], ['get-started', 'Get started', '✧'],
] as const;
function currentScreen() { const id = location.hash.replace(/^#\//, ''); return screens.some(screen => screen[0] === id) ? id : 'chat'; }

export default function App() {
  const [auth, setAuth] = useState<'loading' | 'ready' | 'required'>('loading');
  const [authError, setAuthError] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [screen, setScreen] = useState(currentScreen);
  const [config, setConfig] = useState<Config>();
  const [bots, setBots] = useState<Bot[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [approvalSnapshots] = useState(createApprovalSnapshots);
  const [requestedBot, setRequestedBot] = useState<{ id: string; nonce: number }>();
  const [navCollapsed, setNavCollapsed] = useState(() => { try { return localStorage.getItem('switchboard:nav-collapsed') === 'true'; } catch { return false; } });
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const socket = useRef<Socket | undefined>(undefined);
  const toastId = useRef(0);
  const audio = useRef<AudioContext | undefined>(undefined);
  const navigation = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const notify = useCallback((message: string) => setToasts(previous => [...previous.slice(-3), { id: ++toastId.current, message }]), []);
  const oldestToast = toasts[0]?.id;
  useEffect(() => {
    if (oldestToast === undefined) return;
    const timer = window.setTimeout(() => setToasts(previous => previous.filter(toast => toast.id !== oldestToast)), 8000);
    return () => window.clearTimeout(timer);
  }, [oldestToast]);
  const refreshBots = useCallback(async () => setBots(await api<Bot[]>('/api/bots')), []);
  const refreshApprovals = useCallback(() => approvalSnapshots.refresh(() => api<ApprovalRequest[]>('/api/approvals'), setApprovals), [approvalSnapshots]);
  const onConfig = useCallback(async () => { setConfig(await api<Config>('/api/config')); await refreshBots(); }, [refreshBots]);
  function go(id: string) { location.hash = `/${id}`; setScreen(id); setNavigationOpen(false); }
  function openChat(id: string) { setRequestedBot(previous => ({ id, nonce: (previous?.nonce ?? 0) + 1 })); go('chat'); }
  function closeNavigation() { setNavigationOpen(false); menuButton.current?.focus(); }
  useEffect(() => { const update = () => { setScreen(currentScreen()); setNavigationOpen(false); }; window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  useEffect(() => { try { localStorage.setItem('switchboard:nav-collapsed', String(navCollapsed)); } catch { /* Navigation still works without storage. */ } }, [navCollapsed]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      document.documentElement.style.setProperty('--app-height', `${viewport?.height ?? window.innerHeight}px`);
      if (window.innerWidth > 760) setNavigationOpen(false);
    };
    resize(); viewport?.addEventListener('resize', resize); window.addEventListener('resize', resize);
    return () => { viewport?.removeEventListener('resize', resize); window.removeEventListener('resize', resize); document.documentElement.style.removeProperty('--app-height'); };
  }, []);
  useEffect(() => {
    if (!navigationOpen) return;
    const items = () => [...(navigation.current?.querySelectorAll<HTMLAnchorElement | HTMLButtonElement>('a[href], button:not(:disabled)') ?? [])].filter(item => item.getClientRects().length);
    items()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setNavigationOpen(false); menuButton.current?.focus(); }
      if (event.key !== 'Tab') return;
      const links = items(); const first = links[0]; const last = links.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [navigationOpen]);
  useEffect(() => {
    const unauthorized = () => { setAuth('required'); setAuthError('The server token is no longer valid. Enter its current token.'); };
    window.addEventListener('switchboard:unauthorized', unauthorized);
    void bootstrap().then(() => setAuth('ready')).catch(error => { setAuthError(String(error)); setAuth('required'); });
    return () => window.removeEventListener('switchboard:unauthorized', unauthorized);
  }, []);
  useEffect(() => {
    const unlock = () => { audio.current ??= new AudioContext(); void audio.current.resume().catch(() => undefined); };
    document.addEventListener('pointerdown', unlock, { once: true }); document.addEventListener('keydown', unlock, { once: true });
    return () => { document.removeEventListener('pointerdown', unlock); document.removeEventListener('keydown', unlock); void audio.current?.close(); };
  }, []);
  useEffect(() => {
    if (auth !== 'ready') return;
    let active = true;
    void Promise.all([api<Config>('/api/config'), api<Bot[]>('/api/bots'), refreshApprovals()]).then(([config, bots]) => {
      if (!active) return;
      setConfig(config); setBots(bots);
      if (!config.defaultModel && !location.hash) go('get-started');
    }).catch(error => notify(String(error)));
    socket.current = connectSocket((message: ServerMessage) => {
      if (message.type === 'hello' || message.type === 'approval' || message.type === 'approval_resolved') approvalSnapshots.invalidate();
      if (message.type === 'hello') { setBots(message.bots); setApprovals(message.approvals); }
      if (message.type === 'bots') setBots(message.bots);
      if (message.type === 'approval') {
        setApprovals(previous => [...previous.filter(request => request.id !== message.request.id), message.request]);
        notify(`${message.request.botName} needs approval: ${message.request.summary}`);
        const context = audio.current;
        if (context?.state === 'running') {
          const tone = context.createOscillator(); const gain = context.createGain();
          tone.frequency.value = 620; gain.gain.setValueAtTime(0.035, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2);
          tone.connect(gain); gain.connect(context.destination); tone.start(); tone.stop(context.currentTime + 0.2);
        }
      }
      if (message.type === 'approval_resolved') setApprovals(previous => previous.filter(request => request.id !== message.resolved.id));
      if (message.type === 'skill_learned') notify(`Learned: ${message.name}`);
      if (message.type === 'error' && !message.requestId) notify(message.message);
      window.dispatchEvent(new CustomEvent('switchboard:message', { detail: message }));
    }, setConnected);
    return () => { active = false; approvalSnapshots.invalidate(); socket.current?.close(); socket.current = undefined; };
  }, [auth, notify, approvalSnapshots, refreshApprovals]);
  useEffect(() => { document.title = approvals.length ? `(${approvals.length}) Approval needed · Switchboard` : 'Switchboard'; }, [approvals.length]);
  const send = useCallback((message: unknown) => { if (!socket.current) throw new Error('Not connected.'); socket.current.send(message); }, []);
  if (auth === 'loading') return <main className="auth-page"><div className="card"><h1>Switchboard</h1><p role="status">Connecting to your workspace…</p></div></main>;
  if (auth === 'required') return <main className="auth-page"><form className="card stack" onSubmit={event => { event.preventDefault(); setAuth('loading'); setToken(tokenInput); void api('/api/status').then(() => { setTokenInput(''); setAuth('ready'); }).catch(error => { setAuthError(String(error)); setAuth('required'); }); }}><span className="brand-mark">S</span><h1>Your Switchboard</h1><p className="muted">Enter the server token from your computer’s Switchboard configuration or pairing screen.</p><label>Server token<input type="password" autoComplete="off" required value={tokenInput} onChange={event => setTokenInput(event.target.value)} /></label>{authError && <p role="alert" className="error">{authError}</p>}<button className="primary">Connect</button></form></main>;
  return <div className={`app-shell${navCollapsed ? ' nav-collapsed' : ''}${navigationOpen ? ' navigation-open' : ''}`}>
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
    {navigationOpen && <button className="nav-backdrop" tabIndex={-1} aria-label="Close navigation" onClick={closeNavigation} />}
    <aside id="app-navigation" className="sidebar" ref={navigation}>
      <div className="sidebar-heading"><a className="brand" href="#/chat" aria-label="Switchboard — Chat" onClick={() => setNavigationOpen(false)}><span className="brand-mark" aria-hidden="true">S</span><span className="nav-label">Switchboard</span></a><button className="icon-button mobile-only" aria-label="Close navigation" onClick={closeNavigation}>×</button></div>
      <nav aria-label="Main navigation">{screens.filter(([id]) => id !== 'get-started' || !config?.defaultModel || screen === id).map(([id, label, icon]) => <a key={id} href={`#/${id}`} title={label} aria-label={id === 'approvals' && approvals.length ? `${label}, ${approvals.length} pending` : label} aria-current={screen === id ? 'page' : undefined} onClick={() => setNavigationOpen(false)}><span className="nav-icon" aria-hidden="true">{icon}</span><span className="nav-label">{label}</span>{id === 'approvals' && approvals.length > 0 && <span className="nav-count" aria-hidden="true">{approvals.length}</span>}</a>)}</nav>
      <div className="sidebar-footer"><div className="connection-status" title={connected ? 'Connected to your server' : 'Reconnecting…'}><span className={`status-dot ${connected ? 'online' : ''}`} /><span className="nav-label">{connected ? 'Connected' : 'Reconnecting…'}</span></div><button className="collapse-navigation" aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!navCollapsed} onClick={() => setNavCollapsed(value => !value)}><span aria-hidden="true">{navCollapsed ? '›' : '‹'}</span><span className="nav-label">Collapse</span></button></div>
    </aside>
    <div className="app-workspace" inert={navigationOpen ? true : undefined}>
      <header className="mobile-header"><button ref={menuButton} className="icon-button" aria-label="Open navigation" aria-expanded={navigationOpen} aria-controls="app-navigation" onClick={() => setNavigationOpen(true)}>☰</button><a href="#/chat" className="mobile-brand">Switchboard</a><a className="mobile-approvals" href="#/approvals" aria-label={`${approvals.length} pending approvals`}><span aria-hidden="true">✓</span>{approvals.length > 0 && <span className="nav-count">{approvals.length}</span>}</a></header>
      <div className="toasts" aria-live="polite" aria-label="Notifications">{toasts.map(toast => <div className="toast" key={toast.id}><span>{toast.message}</span><button aria-label="Dismiss notification" onClick={() => setToasts(previous => previous.filter(item => item.id !== toast.id))}>×</button></div>)}</div>
      <main id="main" className={`main${screen === 'chat' ? ' main-chat' : ''}`} tabIndex={-1}>
      {screen !== 'chat' && <header className="page-header"><div><h1>{screens.find(([id]) => id === screen)?.[1] ?? 'Chat'}</h1></div><div className="row"><span className="badge">{bots.length} bots</span><a className="button" href="#/approvals">{approvals.length ? `${approvals.length} awaiting approval` : '✓ All clear'}</a></div></header>}
      {!connected && <div className="connection-banner" role="status">Reconnecting to your server… Sending is paused until the connection returns.</div>}
      {!config && <div className="workspace-loading"><p>Loading workspace configuration…</p><button onClick={() => void onConfig().catch(error => notify(String(error)))}>Retry loading</button></div>}
      {config && <div className="chat-host" hidden={screen !== 'chat'}><Chat bots={bots} defaultBot={config.defaultBot} requestedBot={requestedBot} connected={connected} send={send} notify={notify} approvals={approvals} refreshApprovals={refreshApprovals} visible={screen === 'chat'} /></div>}
      {screen === 'approvals' && <Approvals approvals={approvals} refreshApprovals={refreshApprovals} notify={notify} />}
      {screen === 'bots' && <Bots bots={bots} refreshBots={refreshBots} notify={notify} />}
      {screen === 'workflows' && <Workflows notify={notify} />}
      {screen === 'skills' && <Skills notify={notify} />}
      {screen === 'memory' && <Memory bots={bots} notify={notify} />}
      {screen === 'settings' && <Settings bots={bots} onConfig={onConfig} notify={notify} />}
      {screen === 'pair' && <Pair notify={notify} />}
      {screen === 'get-started' && <GetStarted onConfig={onConfig} notify={notify} openChat={openChat} />}
      </main>
    </div>
  </div>;
}
