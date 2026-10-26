import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import ModelPicker from '../model-picker';
import type { Bot, ProviderSummary, Skill } from '../types';

const tools = ['read_file', 'list_dir', 'write_file', 'edit_file', 'shell', 'web_fetch', 'load_skill', 'save_skill', 'remember', 'send_message', 'schedule_workflow', 'describe_capabilities'];
const categories = ['read', 'write', 'shell', 'network', 'messaging', 'self-modify'] as const;
const blank: Bot = { id: '', name: '', emoji: '🤖', description: '', systemPrompt: '', model: { provider: '', id: '' }, thinking: 'off', tools: '*', skills: '*', memory: true, budgetUsd: 0, policy: {} };

export default function Bots({ bots, refreshBots, notify }: { bots: Bot[]; refreshBots: () => Promise<void>; notify: (message: string) => void }) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [usage, setUsage] = useState<{ botId: string; cost: number }[]>([]);
  const [draft, setDraft] = useState<Bot | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError('');
    Promise.all([api<{ providers: ProviderSummary[] }>('/api/providers'), api<Skill[]>('/api/skills'), api<{ botId: string; cost: number }[]>('/api/usage')])
      .then(([p, s, u]) => { if (!ignore) { setProviders(p.providers); setSkills(s); setUsage(u); } })
      .catch(e => { if (!ignore) setError(String(e.message ?? e)); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [reload]);

  function edit(bot: Bot | null) {
    if (draft && !window.confirm('Discard the open bot draft?')) return;
    setEditing(Boolean(bot));
    setDraft(bot ? structuredClone(bot) : { ...blank, model: { provider: providers.find(p => p.configured)?.id ?? '', id: '' } });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (!editing && bots.some(b => b.id === draft.id)) { notify('That bot ID already exists. Choose another ID.'); return; }
    setBusy(true);
    try {
      await api(`/api/bots/${encodeURIComponent(draft.id)}`, 'PUT', draft);
      await refreshBots();
      setDraft(null);
      notify('Bot saved. Start a new conversation to use all updated settings.');
    } catch (e) { notify(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function remove(bot: Bot) {
    if (!window.confirm(`Delete ${bot.name}? Its configuration will be removed. Existing transcripts are kept.`)) return;
    setBusy(true);
    try {
      await api(`/api/bots/${encodeURIComponent(bot.id)}`, 'DELETE');
      await refreshBots();
      if (draft?.id === bot.id) setDraft(null);
      notify('Bot deleted. Guide is recreated while enabled; deleting the last bot restores the built-in bots.');
    } catch (e) { notify(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div className="stack">
    <div className="toolbar"><p className="muted">Give each bot a job, model and approval policy.</p><button className="primary" disabled={busy || loading} onClick={() => edit(null)}>New bot</button></div>
    {loading && <p role="status">Loading models, skills and usage…</p>}
    {error && <div className="error" role="alert">{error} <button onClick={() => setReload(n => n + 1)}>Retry</button></div>}
    {!bots.length && <p className="card">No bots yet. Create one to start a conversation.</p>}
    <div className="grid">{bots.map(bot => <article className="card stack" key={bot.id}>
      <h2>{bot.emoji} {bot.name}</h2><p>{bot.description || 'No description yet.'}</p>
      <small className="muted">{bot.model.provider} / {bot.model.id}</small>
      <p>${(usage.find(u => u.botId === bot.id)?.cost ?? 0).toFixed(4)} this month{bot.budgetUsd > 0 ? ` / $${bot.budgetUsd} budget` : ' · no budget cap'}</p>
      <div className="row"><button disabled={busy || loading} onClick={() => edit(bot)}>Edit {bot.name}</button><button className="danger" disabled={busy} onClick={() => void remove(bot)}>Delete</button></div>
    </article>)}</div>
    {draft && <form className="card stack editor" onSubmit={e => void save(e)}>
      <h2>{editing ? `Edit ${draft.name}` : 'New bot'}</h2>
      <fieldset disabled={busy} className="stack">
        <div className="grid"><label>ID<input required pattern="[a-z0-9][a-z0-9-]{0,39}" maxLength={40} readOnly={editing} value={draft.id} onChange={e => setDraft({ ...draft, id: e.target.value })} /></label>
          <label>Name<input required maxLength={60} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
          <label>Emoji<input maxLength={8} value={draft.emoji} onChange={e => setDraft({ ...draft, emoji: e.target.value })} /></label></div>
        <label>Description<input maxLength={500} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
        <label>System prompt<textarea rows={7} maxLength={20000} value={draft.systemPrompt} onChange={e => setDraft({ ...draft, systemPrompt: e.target.value })} /></label>
        <ModelPicker providers={providers} value={draft.model} onChange={model => setDraft({ ...draft, model })} />
        <div className="grid"><label>Thinking level<select value={draft.thinking} onChange={e => setDraft({ ...draft, thinking: e.target.value as Bot['thinking'] })}>{['off', 'minimal', 'low', 'medium', 'high'].map(level => <option key={level}>{level}</option>)}</select></label>
          <label>Monthly budget (USD)<input type="number" min={0} step="0.01" required value={draft.budgetUsd} onChange={e => setDraft({ ...draft, budgetUsd: Number(e.target.value) })} /><small className="muted">0 means unlimited. Costs use catalog estimates; custom endpoints can report $0. Set billing limits with your provider too.</small></label></div>
        <fieldset><legend>Tools</legend><label className="row"><input type="checkbox" checked={draft.tools === '*'} onChange={e => setDraft({ ...draft, tools: e.target.checked ? '*' : [] })} />All tools</label>
          {draft.tools !== '*' && <div className="grid">{[...new Set([...tools, ...draft.tools])].map(tool => <label className="row" key={tool}><input type="checkbox" checked={draft.tools.includes(tool)} onChange={e => setDraft({ ...draft, tools: e.target.checked ? [...(draft.tools as string[]), tool] : (draft.tools as string[]).filter(t => t !== tool) })} />{tool}</label>)}</div>}
        </fieldset>
        <fieldset><legend>Skills</legend><label className="row"><input type="checkbox" checked={draft.skills === '*'} onChange={e => setDraft({ ...draft, skills: e.target.checked ? '*' : [] })} />All installed skills</label>
          {draft.skills !== '*' && <div className="grid">{[...new Set([...skills.map(s => s.name), ...draft.skills])].map(skill => <label className="row" key={skill}><input type="checkbox" checked={draft.skills.includes(skill)} onChange={e => setDraft({ ...draft, skills: e.target.checked ? [...(draft.skills as string[]), skill] : (draft.skills as string[]).filter(s => s !== skill) })} />{skill}</label>)}</div>}
          {!skills.length && <p className="muted">No installed skills. Add one in Skills.</p>}
        </fieldset>
        <label className="row"><input type="checkbox" checked={draft.memory} onChange={e => setDraft({ ...draft, memory: e.target.checked })} />Use saved memory</label>
        <fieldset><legend>Approval policy</legend><div className="grid">{categories.map(category => <label key={category}>{category}<select value={draft.policy[category] ?? (category === 'read' ? 'auto' : 'ask')} onChange={e => setDraft({ ...draft, policy: { ...draft.policy, [category]: e.target.value } })}><option value="auto">Auto: allow</option><option value="ask">Ask for approval</option><option value="never">Never: block</option></select></label>)}</div></fieldset>
        <label>Working directory<input value={draft.workdir ?? ''} onChange={e => setDraft({ ...draft, workdir: e.target.value })} placeholder="Use the general working directory" /></label>
        <p className="muted">File tools stay inside the working directory. Shell commands run with your account permissions and are not sandboxed.</p>
        {draft.builtin && <p className="badge">Built-in bot</p>}
        <div className="row"><button className="primary" type="submit">{busy ? 'Saving…' : 'Save bot'}</button><button type="button" onClick={() => { if (window.confirm('Discard this bot draft?')) setDraft(null); }}>Cancel</button></div>
      </fieldset>
    </form>}
  </div>;
}
