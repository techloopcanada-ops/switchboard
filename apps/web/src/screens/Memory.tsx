import { useEffect, useState } from 'react';
import { api } from '../api';
import { LoadState, useResource } from '../resource';
import type { Bot } from '../types';

export default function Memory({ bots, notify }: { bots: Bot[]; notify: (message: string) => void }) {
  const [botId, setBotId] = useState('');
  const path = `/api/memory${botId ? `?bot=${encodeURIComponent(botId)}` : ''}`;
  const resource = useResource<{ text: string }>(path);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (resource.data) { setText(resource.data.text); setSaved(resource.data.text); } }, [resource.data]);
  async function save() { if (text.length > 12000) { notify('Memory is limited to 12,000 characters. Shorten it before saving.'); return; } setBusy(true); try { await api(path, 'PUT', { text }); setSaved(text); notify('Memory saved. Start a new chat to use it.'); } catch (error) { notify(String(error)); } finally { setBusy(false); } }
  return <form className="card stack" onSubmit={event => { event.preventDefault(); void save(); }}><div><h2>A little context goes a long way</h2><p className="muted">USER.md is shared with all bots. Each bot also has its own MEMORY.md.</p></div><label>Memory file<select value={botId} disabled={busy} onChange={event => { if (text !== saved && !confirm('Discard unsaved memory changes?')) return; setBotId(event.target.value); }}>{[<option key="" value="">USER.md · Your profile</option>, ...bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name} · MEMORY.md</option>)]}</select></label><LoadState loading={resource.loading} error={resource.error} retry={resource.refresh} /><label>{botId ? 'MEMORY.md' : 'USER.md'}<textarea className="code-editor" rows={20} maxLength={12000} value={text} disabled={resource.loading || busy || !!resource.error} onChange={event => setText(event.target.value)} placeholder="Preferences, useful context, and facts to remember…" /></label><div className="toolbar"><span className="muted small">{text.length.toLocaleString()} / 12,000 characters. Store only information you want your model provider to receive.</span><button className="primary" disabled={resource.loading || busy || !!resource.error || text === saved}>{busy ? 'Saving…' : 'Save memory'}</button></div></form>;
}
