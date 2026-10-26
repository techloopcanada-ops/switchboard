import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import ModelPicker from '../model-picker';
import type { Bot, Config, ProviderConfig, ProviderSummary, ReferralLink } from '../types';

export default function GetStarted({ onConfig, notify, openChat }: { onConfig: () => Promise<void>; notify: (message: string) => void; openChat: (botId: string) => void }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [referrals, setReferrals] = useState<{ disclosure: string; links: ReferralLink[] }>({ disclosure: '', links: [] });
  const [providerId, setProviderId] = useState('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState<Bot['model']>({ provider: '', id: '' });
  const [updateBuiltins, setUpdateBuiltins] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let ignore = false;
    setError('');
    Promise.all([api<Config>('/api/config'), api<{ providers: ProviderSummary[] }>('/api/providers'), api<{ disclosure: string; links: ReferralLink[] }>('/api/referrals')]).then(([c, p, r]) => {
      if (ignore) return;
      setConfig(c); setProviders(p.providers); setReferrals(r); setApiKey(c.providers.openrouter?.apiKey ?? '');
      if (c.defaultModel) { setModel(c.defaultModel); setReady(true); }
    }).catch(e => { if (!ignore) setError(String(e.message ?? e)); });
    return () => { ignore = true; };
  }, [reload]);
  async function saveProvider(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const latest = await api<Config>('/api/config');
      const local = providerId === 'ollama' || providerId === 'lmstudio';
      const provider: ProviderConfig = local ? { kind: 'openai-compatible', name: providerId === 'ollama' ? 'Ollama' : 'LM Studio', baseUrl: providerId === 'ollama' ? 'http://localhost:11434/v1' : 'http://localhost:1234/v1', apiKey } : { kind: 'builtin', apiKey };
      const saved = await api<Config>('/api/config', 'PUT', { providers: { ...latest.providers, [providerId]: provider } });
      setConfig(saved); setApiKey(saved.providers[providerId]?.apiKey ?? '');
      const result = await api<{ providers: ProviderSummary[]; errors: Record<string, string> }>('/api/providers?refresh=1');
      setProviders(result.providers);
      setModel({ provider: providerId, id: result.providers.find(p => p.id === providerId)?.models[0]?.id ?? '' });
      notify(Object.keys(result.errors).length ? `Provider saved. Model refresh: ${Object.entries(result.errors).map(([id, message]) => `${id}: ${message}`).join('; ')}` : 'Provider saved. Pick a default model next.');
    } catch (e) { notify(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function saveModel(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const saved = await api<Config>('/api/config', 'PUT', { defaultModel: model, guideBot: true });
      // Also update built-in bots that were explicitly assigned a different model.
      if (updateBuiltins) {
        const bots = await api<Bot[]>('/api/bots');
        for (const bot of bots.filter(b => b.builtin)) await api(`/api/bots/${encodeURIComponent(bot.id)}`, 'PUT', { ...bot, model });
      }
      setConfig(saved); setReady(true); await onConfig();
      notify(updateBuiltins ? 'Default and built-in bot models saved. Say hello to Guide.' : 'Default saved. Bots on the previous default follow it; other model choices stay as configured.');
    } catch (e) { notify(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const install = 'git clone YOUR_REPOSITORY_URL switchboard-source\ncd switchboard-source/switchboard\nnpm install\nnpm run build\nnode packages/core/dist/cli.js setup\nnode packages/core/dist/cli.js start';
  function links(kind: ReferralLink['kind']) {
    return referrals.links.filter(link => link.kind === kind).map(link => <article className="card stack" key={link.id}>
      <h3><a href={link.href} target="_blank" rel="noreferrer">{link.name}</a>{link.affiliate && <small className="badge"> affiliate</small>}</h3>
      <p>{link.what}</p><small>{link.reward}</small><small className="muted">{link.evidence}</small>
    </article>);
  }
  if (!config) return <div className="card">{error ? <p role="alert" className="error">{error} <button onClick={() => setReload(n => n + 1)}>Retry</button></p> : <p role="status">Preparing your Switchboard…</p>}</div>;
  return <div className="stack">
    <div className="card stack"><p className="badge">A few minutes to your first conversation</p><h2>Your bots. Your models.</h2><p>Connect a provider, choose a model and ask Guide what this installation can do.</p></div>
    <section className="card stack"><h2>1. Choose a provider</h2><form className="stack" onSubmit={e => void saveProvider(e)}><fieldset className="stack" disabled={busy}>
      <label>Provider<select value={providerId} onChange={e => { setProviderId(e.target.value); setApiKey(config.providers[e.target.value]?.apiKey ?? ''); }}><option value="openrouter">OpenRouter</option><option value="ollama">Ollama · local</option><option value="lmstudio">LM Studio · local</option>{providers.filter(p => p.kind === 'builtin' && p.id !== 'openrouter').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>API key{['ollama', 'lmstudio'].includes(providerId) ? ' (optional)' : ''}<input type="password" required={!['ollama', 'lmstudio'].includes(providerId) && !providers.find(p => p.id === providerId)?.configured} autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} /></label>
      {providerId === 'ollama' && <p className="muted">Run Ollama on the Switchboard machine and pull a model first. The preset connects to http://localhost:11434/v1.</p>}
      {providerId === 'lmstudio' && <p className="muted">Load a model and start LM Studio’s local server on the Switchboard machine. The preset connects to http://localhost:1234/v1.</p>}
      <div className="row"><button className="primary" type="submit">Save provider</button><a href="#/settings">Advanced provider settings</a></div>
    </fieldset></form><p className="muted">{referrals.disclosure}</p><div className="grid">{links('inference')}</div></section>
    <section className="card stack"><h2>2. Set your default model</h2><form className="stack" onSubmit={e => void saveModel(e)}><fieldset className="stack" disabled={busy}>
      <ModelPicker providers={providers} value={model} onChange={setModel} />
      <label className="row"><input type="checkbox" checked={updateBuiltins} onChange={e => setUpdateBuiltins(e.target.checked)} />Use this model for built-in bots (Assistant, Coder and Guide)</label>
      <small className="muted">Bots on the previous default follow the new default. This checkbox also replaces other built-in bot model choices.</small>
      <button className="primary" type="submit">Save model and enable Guide</button>
    </fieldset></form></section>
    <section className="card stack"><h2>3. Say hello to Guide</h2><p>Try: “What can this Switchboard do, and how do I connect my phone?”</p><button className="primary" disabled={busy || !ready} onClick={() => openChat('guide')}>Open Guide chat</button>{!ready && <small className="muted">Save a default model first.</small>}</section>
    <section className="card stack"><h2>Run 24/7 on a server</h2><p>Use a VPS with Node.js 22.19 or newer. Keep the API private and use Tailscale to reach it from your phone.</p><p className="muted">{referrals.disclosure}</p><div className="grid">{links('hosting')}{links('gpu')}</div>
      <p>Replace <code>YOUR_REPOSITORY_URL</code> with your repository URL. These commands assume it contains the <code>switchboard/</code> folder. The npm package has not been published.</p><pre><code>{install}</code></pre>
      <button onClick={() => { if (!navigator.clipboard) { notify('Clipboard unavailable. Select and copy the commands above.'); return; } void navigator.clipboard.writeText(install).then(() => notify('Install commands copied. Replace YOUR_REPOSITORY_URL before running.')).catch(() => notify('Clipboard unavailable. Select and copy the commands above.')); }}>Copy install commands</button>
      <p className="muted">The start command runs in the foreground. Use a service manager for restart after logout or reboot; see docs/SETUP.md.</p>
    </section>{busy && <p role="status">Saving your setup…</p>}
  </div>;
}
