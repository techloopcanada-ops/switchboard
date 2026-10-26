import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import ModelPicker from '../model-picker';
import type { Bot, Config, ProviderConfig, ProviderSummary, ReferralLink } from '../types';

export default function Settings({ bots, onConfig, notify }: { bots: Bot[]; onConfig: () => Promise<void>; notify: (message: string) => void }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [referrals, setReferrals] = useState<{ disclosure: string; links: ReferralLink[] }>({ disclosure: '', links: [] });
  const [channels, setChannels] = useState<string[]>([]);
  const [providerId, setProviderId] = useState('openrouter');
  const [provider, setProvider] = useState<ProviderConfig>({ kind: 'builtin', apiKey: '' });
  const [telegramIds, setTelegramIds] = useState('');
  const [discordIds, setDiscordIds] = useState('');
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    let ignore = false;
    setError('');
    Promise.all([api<Config>('/api/config'), api<{ providers: ProviderSummary[] }>('/api/providers'), api<{ disclosure: string; links: ReferralLink[] }>('/api/referrals'), api<{ connected: string[] }>('/api/channels')])
      .then(([c, p, r, ch]) => {
        if (ignore) return;
        setConfig(c); setProviders(p.providers); setReferrals(r); setChannels(ch.connected);
        setTelegramEnabled(Boolean(c.telegram)); setDiscordEnabled(Boolean(c.discord));
        setTelegramIds(c.telegram?.allowedUserIds.join(', ') ?? ''); setDiscordIds(c.discord?.allowedUserIds.join(', ') ?? '');
        setProvider(c.providers.openrouter ?? { kind: 'builtin', apiKey: '' });
      }).catch(e => { if (!ignore) setError(String(e.message ?? e)); });
    return () => { ignore = true; };
  }, [reload]);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); } catch (e) { notify(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function savePatch(patch: Record<string, unknown>, message: string) {
    await api<Config>('/api/config', 'PUT', patch);
    await onConfig();
    const ch = await api<{ connected: string[] }>('/api/channels');
    setChannels(ch.connected);
    notify(message);
  }
  async function refreshModels() {
    const result = await api<{ providers: ProviderSummary[]; errors: Record<string, string> }>('/api/providers?refresh=1');
    setProviders(result.providers); setModelErrors(result.errors);
  }
  function selectProvider(id: string) {
    setProviderId(id);
    setProvider(config?.providers[id] ?? { kind: 'builtin', apiKey: '' });
  }
  function preset(id: 'ollama' | 'lmstudio') {
    setProviderId(id);
    setProvider(config?.providers[id] ?? { kind: 'openai-compatible', name: id === 'ollama' ? 'Ollama' : 'LM Studio', baseUrl: id === 'ollama' ? 'http://localhost:11434/v1' : 'http://localhost:1234/v1', apiKey: '' });
  }
  function submitProvider(e: FormEvent) {
    e.preventDefault();
    void act(async () => {
      if (provider.kind === 'openai-compatible' && providers.some(p => p.id === providerId && p.kind === 'builtin')) throw new Error('Choose a custom provider ID that does not replace a built-in provider.');
      const latest = await api<Config>('/api/config');
      const saved = await api<Config>('/api/config', 'PUT', { providers: { ...latest.providers, [providerId]: provider } });
      setConfig(c => c ? { ...c, providers: saved.providers } : saved);
      setProvider(saved.providers[providerId]);
      await refreshModels(); await onConfig();
      notify('Provider saved. Choose its model below or in Bots.');
    });
  }
  function saveChannels(e: FormEvent) {
    e.preventDefault();
    void act(async () => {
      const t = telegramIds.split(/[\s,]+/).filter(Boolean);
      const d = discordIds.split(/[\s,]+/).filter(Boolean);
      if (telegramEnabled && t.some(id => !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) throw new Error('Telegram IDs must be positive whole numbers, separated by commas or spaces.');
      if (discordEnabled && d.some(id => !/^\d{5,30}$/.test(id))) throw new Error('Discord IDs must be 5–30 digits, separated by commas or spaces.');
      await savePatch({ telegram: telegramEnabled ? { ...config?.telegram, allowedUserIds: t.map(Number) } : null, discord: discordEnabled ? { ...config?.discord, allowedUserIds: d } : null }, 'Channel settings saved. Check the connected list; a saved token does not guarantee a successful connection.');
    });
  }
  if (!config) return <div className="card">{error ? <p className="error" role="alert">{error} <button onClick={() => setReload(n => n + 1)}>Retry</button></p> : <p role="status">Loading settings…</p>}</div>;
  const botOptions = bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>);
  return <div className="stack">
    <section id="providers" className="card stack"><h2>Providers</h2><p className="muted">Bring a key or connect a local model server.</p>
      <div className="table-scroll"><table><thead><tr><th>Provider</th><th>Configured</th><th>Source</th><th>Models</th></tr></thead><tbody>{providers.map(p => <tr key={p.id}><td><button disabled={busy} onClick={() => selectProvider(p.id)}>{p.name}</button></td><td>{p.configured ? 'Yes' : 'No'}</td><td>{p.source ?? '—'}</td><td>{p.models.length}</td></tr>)}</tbody></table></div>
      <button disabled={busy} onClick={() => void act(async () => { await refreshModels(); notify('Model catalogs refreshed.'); })}>Refresh models</button>
      {Object.entries(modelErrors).map(([id, message]) => <p role="alert" className="error" key={id}>{id}: {message}</p>)}
      <form className="stack" onSubmit={submitProvider}><h3>Add or edit a provider</h3><fieldset disabled={busy} className="stack">
        <div className="row"><button type="button" onClick={() => preset('ollama')}>Ollama preset</button><button type="button" onClick={() => preset('lmstudio')}>LM Studio preset</button></div>
        <label>Provider type<select value={provider.kind} onChange={e => {
          const kind = e.target.value as ProviderConfig['kind'];
          setProviderId(kind === 'builtin' ? 'openrouter' : '');
          setProvider(kind === 'builtin' ? config.providers.openrouter ?? { kind } : { kind, name: '', baseUrl: '', apiKey: '' });
        }}><option value="builtin">Built-in provider</option><option value="openai-compatible">OpenAI-compatible server</option></select></label>
        {provider.kind === 'builtin' ? <label>Provider<select value={providerId} onChange={e => selectProvider(e.target.value)}>{providers.filter(p => p.kind === 'builtin').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label> : <>
          <div className="grid"><label>Provider ID<input required pattern="[a-z0-9][a-z0-9-]{0,39}" maxLength={40} value={providerId} onChange={e => setProviderId(e.target.value)} /></label><label>Name<input value={provider.name ?? ''} onChange={e => setProvider({ ...provider, name: e.target.value })} /></label></div>
          <label>Base URL<input required type="url" pattern="https?://.*" value={provider.baseUrl ?? ''} onChange={e => setProvider({ ...provider, baseUrl: e.target.value })} placeholder="http://localhost:11434/v1" /></label>
          <small className="muted">Localhost means the machine running Switchboard, including when you use a remote browser.</small>
        </>}
        <label>API key{provider.kind === 'openai-compatible' ? ' (optional)' : ''}<input type="password" autoComplete="off" value={provider.apiKey ?? ''} onChange={e => setProvider({ ...provider, apiKey: e.target.value })} /></label>
        <small className="muted">Saved keys are masked. Leave the mask unchanged to keep a key. Clearing the field removes it.</small>
        <button className="primary" type="submit">Save provider</button>
      </fieldset></form>
      <form className="stack" onSubmit={e => { e.preventDefault(); void act(() => savePatch({ defaultModel: config.defaultModel }, 'Default model saved. Bots on the previous default now follow this model; other choices are preserved.')); }}><h3>Default model</h3><fieldset disabled={busy} className="stack">
        <ModelPicker providers={providers} value={config.defaultModel ?? { provider: '', id: '' }} onChange={defaultModel => setConfig({ ...config, defaultModel })} />
        <button className="primary" type="submit">Save default model</button><p className="muted">Bots using the previous default follow the new default. Bots set to a different model keep it. Edit individual choices in Bots.</p>
      </fieldset></form>
    </section>
    <section id="channels" className="card stack"><h2>Channels</h2><p>Connected: {channels.length ? channels.join(', ') : 'none'}</p>
      <button disabled={busy} onClick={() => void act(async () => { const result = await api<{ connected: string[] }>('/api/channels/restart', 'POST'); setChannels(result.connected); notify('Channel restart finished. Check the connected list.'); })}>Restart channels</button>
      <form className="stack" onSubmit={saveChannels}><fieldset disabled={busy} className="stack">
        <h3>Telegram</h3><label className="row"><input type="checkbox" checked={telegramEnabled} onChange={e => setTelegramEnabled(e.target.checked)} />Enable Telegram</label>
        {telegramEnabled && <><label>Telegram bot token<input required type="password" autoComplete="off" value={config.telegram?.token ?? ''} onChange={e => setConfig({ ...config, telegram: { allowedUserIds: [], ...config.telegram, token: e.target.value } })} /></label><label>Allowed Telegram user IDs<input value={telegramIds} onChange={e => setTelegramIds(e.target.value)} placeholder="123456789, 987654321" /></label><label>Telegram default bot<select value={config.telegram?.defaultBot ?? config.defaultBot} onChange={e => setConfig({ ...config, telegram: { token: '', allowedUserIds: [], ...config.telegram, defaultBot: e.target.value } })}>{botOptions}</select></label></>}
        <details><summary>Set up Telegram in five steps</summary><ol><li>Open <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> in Telegram. Send <code>/newbot</code>.</li><li>Choose a name and unique username ending in <code>bot</code>. Copy the token into the field above.</li><li>Enable Telegram and save with the allowed list empty. This allows nobody yet.</li><li>Open your bot and send <code>/start</code>. Copy the user ID it reports into Allowed Telegram user IDs.</li><li>Choose a default bot, save again, then send <code>/start</code> and a message.</li></ol></details>
        <h3>Discord</h3><label className="row"><input type="checkbox" checked={discordEnabled} onChange={e => setDiscordEnabled(e.target.checked)} />Enable Discord</label>
        {discordEnabled && <><label>Discord bot token<input required type="password" autoComplete="off" value={config.discord?.token ?? ''} onChange={e => setConfig({ ...config, discord: { allowedUserIds: [], ...config.discord, token: e.target.value } })} /></label><label>Allowed Discord user IDs<input value={discordIds} onChange={e => setDiscordIds(e.target.value)} placeholder="123456789012345678" /></label><label>Discord default bot<select value={config.discord?.defaultBot ?? config.defaultBot} onChange={e => setConfig({ ...config, discord: { token: '', allowedUserIds: [], ...config.discord, defaultBot: e.target.value } })}>{botOptions}</select></label></>}
        <details><summary>Set up Discord in seven steps</summary><ol><li>Open the <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">Discord Developer Portal</a> and create an application.</li><li>Open Bot, create or reset the bot token, and copy it into the field above.</li><li>Under Bot, enable Message Content Intent.</li><li>Under OAuth2 → URL Generator, select the bot scope and View Channels, Send Messages and Read Message History permissions.</li><li>Open the generated URL and invite the bot to your server.</li><li>In Discord, enable Developer Mode in Settings → Advanced. Copy your user ID into the allowed list above.</li><li>Enable Discord, choose a bot and save. DM the bot or mention it in a server message.</li></ol></details>
        <p className="muted">An empty allowed list permits nobody. Telegram and Discord connect outbound; no public port is needed.</p><button className="primary" type="submit">Save channels</button>
      </fieldset></form>
    </section>
    <section id="general" className="card stack"><h2>General</h2><form className="stack" onSubmit={e => { e.preventDefault(); void act(() => savePatch({ approvalTimeoutSec: config.approvalTimeoutSec, guideBot: config.guideBot, defaultBot: config.defaultBot, workdir: config.workdir, server: config.server, referralCodes: config.referralCodes }, 'General settings saved. Restart Switchboard to apply host or port changes.')); }}><fieldset disabled={busy} className="stack">
      <div className="grid"><label>Approval timeout (seconds)<input required type="number" min={5} max={86400} step={1} value={config.approvalTimeoutSec} onChange={e => setConfig({ ...config, approvalTimeoutSec: Number(e.target.value) })} /></label><label>Default bot<select value={config.defaultBot} onChange={e => setConfig({ ...config, defaultBot: e.target.value })}>{botOptions}</select></label></div>
      <label className="row"><input type="checkbox" checked={config.guideBot} onChange={e => setConfig({ ...config, guideBot: e.target.checked })} />Show Guide tutorial bot</label>
      <label>Working directory<input required value={config.workdir} onChange={e => setConfig({ ...config, workdir: e.target.value })} /></label>
      <div className="grid"><label>Server host<select value={config.server.host} onChange={e => setConfig({ ...config, server: { ...config.server, host: e.target.value } })}><option value="127.0.0.1">127.0.0.1 · this machine</option><option value="0.0.0.0">0.0.0.0 · local network</option>{!['127.0.0.1', '0.0.0.0'].includes(config.server.host) && <option value={config.server.host}>{config.server.host}</option>}</select></label><label>Port<input required type="number" min={1024} max={65535} step={1} value={config.server.port} onChange={e => setConfig({ ...config, server: { ...config.server, port: Number(e.target.value) } })} /></label></div>
      {config.server.host === '0.0.0.0' && <p className="error">0.0.0.0 exposes the token-protected API to your LAN. Use a trusted network or Tailscale, protect your token, and do not forward this port to the internet.</p>}
      <p className="muted">Host and port changes require a restart. Shell commands have your account permissions; the working directory is not a shell sandbox.</p>
      <h3>Referral codes</h3><p className="muted">{referrals.disclosure}</p><div className="grid">{referrals.links.map(link => <label key={link.id}>{link.name}<input pattern="[A-Za-z0-9_\-]{0,64}" maxLength={64} value={config.referralCodes[link.id] ?? ''} onChange={e => setConfig({ ...config, referralCodes: { ...config.referralCodes, [link.id]: e.target.value } })} /><small className="muted">{link.template ? 'Your programme code' : 'No referral URL template available'}</small></label>)}</div>
      <button className="primary" type="submit">Save general settings</button>
    </fieldset></form></section>
    {busy && <p role="status">Saving or refreshing…</p>}
  </div>;
}

