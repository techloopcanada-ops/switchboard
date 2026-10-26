import { useCallback, useEffect, useRef, useState } from 'react';
import { api, bootstrap, setToken } from './api';
import { connectSocket, type Socket } from './ws';
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
  const [selectedBot, setSelectedBot] = useState('assistant');
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const socket = useRef<Socket | undefined>(undefined);
  const toastId = useRef(0);
  const audio = useRef<AudioContext | undefined>(undefined);
  const notify = useCallback((message: string) => setToasts(previous => [...previous.slice(-3), { id: ++toastId.current, message }]), []);
  const refreshBots = useCallback(async () => setBots(await api<Bot[]>('/api/bots')), []);
  const refreshApprovals = useCallback(async () => setApprovals(await api<ApprovalRequest[]>('/api/approvals')), []);
  const onConfig = useCallback(async () => { setConfig(await api<Config>('/api/config')); await refreshBots(); }, [refreshBots]);
  function go(id: string) { location.hash = `/${id}`; setScreen(id); }
  function openChat(id: string) { setSelectedBot(id); go('chat'); }
  useEffect(() => { const update = () => setScreen(currentScreen()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
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
    void Promise.all([api<Config>('/api/config'), api<Bot[]>('/api/bots'), api<ApprovalRequest[]>('/api/approvals')]).then(([config, bots, pending]) => {
      if (!active) return;
      setConfig(config); setBots(bots); setApprovals(pending);
      if (!config.defaultModel && !location.hash) go('get-started');
    }).catch(error => notify(String(error)));
    socket.current = connectSocket((message: ServerMessage) => {
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
      if (message.type === 'error' && !message.requestId) notify(message.message);
      window.dispatchEvent(new CustomEvent('switchboard:message', { detail: message }));
    }, setConnected);
    return () => { active = false; socket.current?.close(); socket.current = undefined; };
  }, [auth, notify]);
  useEffect(() => { document.title = approvals.length ? `(${approvals.length}) Approval needed · Switchboard` : 'Switchboard'; }, [approvals.length]);
  const send = useCallback((message: unknown) => { if (!socket.current) throw new Error('Not connected.'); socket.current.send(message); }, []);
  if (auth === 'loading') return <main className="auth-page"><div className="card"><h1>Switchboard</h1><p role="status">Connecting to your workspace…</p></div></main>;
  if (auth === 'required') return <main className="auth-page"><form className="card stack" onSubmit={event => { event.preventDefault(); setAuth('loading'); setToken(tokenInput); void api('/api/status').then(() => { setTokenInput(''); setAuth('ready'); }).catch(error => { setAuthError(String(error)); setAuth('required'); }); }}><span className="brand-mark">S</span><h1>Your Switchboard</h1><p className="muted">Enter the server token from your computer’s Switchboard configuration or pairing screen.</p><label>Server token<input type="password" autoComplete="off" required value={tokenInput} onChange={event => setTokenInput(event.target.value)} /></label>{authError && <p role="alert" className="error">{authError}</p>}<button className="primary">Connect</button></form></main>;
  return <div className="app-shell"><a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a><aside className="sidebar"><a className="brand" href="#/chat"><span className="brand-mark">S</span><span>Switchboard<small>Your bots. Your call.</small></span></a><nav aria-label="Main navigation">{screens.filter(([id]) => id !== 'get-started' || !config?.defaultModel || screen === id).map(([id, label, icon]) => <a key={id} href={`#/${id}`} aria-current={screen === id ? 'page' : undefined}><span aria-hidden="true">{icon}</span>{label}{id === 'approvals' && approvals.length > 0 && <span className="nav-count">{approvals.length}</span>}</a>)}</nav><div className="sidebar-footer"><span className={`status-dot ${connected ? 'online' : ''}`} />{connected ? 'Connected to your server' : 'Reconnecting…'}<small>Local by default. Always yours.</small></div></aside>
    <main id="main" className="main" tabIndex={-1}><header className="page-header"><div><p className="eyebrow">YOUR WORKSPACE</p><h1>{screens.find(([id]) => id === screen)?.[1] ?? 'Chat'}</h1></div><div className="row"><span className="badge">{bots.length} bots</span><a className="button" href="#/approvals">{approvals.length ? `${approvals.length} awaiting approval` : '✓ All clear'}</a></div></header>
      {!connected && <div className="connection-banner" role="status">Connection interrupted. Reconnecting automatically. Chat sending is paused; review the transcript after reconnecting.</div>}
      {!config && <div className="card"><p>Workspace configuration has not loaded.</p><button onClick={() => void onConfig().catch(error => notify(String(error)))}>Retry loading</button></div>}
      <div hidden={screen !== 'chat'}><Chat bots={bots} selectedBot={selectedBot} onBot={setSelectedBot} connected={connected} send={send} notify={notify} /></div>
      {screen === 'approvals' && <Approvals approvals={approvals} refreshApprovals={refreshApprovals} notify={notify} />}
      {screen === 'bots' && <Bots bots={bots} refreshBots={refreshBots} notify={notify} />}
      {screen === 'workflows' && <Workflows notify={notify} />}
      {screen === 'skills' && <Skills notify={notify} />}
      {screen === 'memory' && <Memory bots={bots} notify={notify} />}
      {screen === 'settings' && <Settings bots={bots} onConfig={onConfig} notify={notify} />}
      {screen === 'pair' && <Pair notify={notify} />}
      {screen === 'get-started' && <GetStarted onConfig={onConfig} notify={notify} openChat={openChat} />}
    </main><div className="toasts" aria-live="polite" aria-label="Notifications">{toasts.map(toast => <div className="toast" key={toast.id}><span>{toast.message}</span><button aria-label="Dismiss notification" onClick={() => setToasts(previous => previous.filter(item => item.id !== toast.id))}>×</button></div>)}</div></div>;
}
