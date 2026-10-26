import { useId } from 'react';
import type { Bot, ProviderSummary } from './types';

export default function ModelPicker({ providers, value, onChange }: {
  providers: ProviderSummary[];
  value: Bot['model'];
  onChange: (value: Bot['model']) => void;
}) {
  const listId = useId();
  const provider = providers.find(p => p.id === value.provider);
  return <div className="grid">
    <label>Provider
      <select required value={value.provider} onChange={e => {
        const next = providers.find(p => p.id === e.target.value);
        onChange({ provider: e.target.value, id: next?.models[0]?.id ?? '' });
      }}>
        <option value="">Choose a provider</option>
        {value.provider && !provider && <option value={value.provider}>{value.provider} (unavailable)</option>}
        {providers.map(p => <option key={p.id} value={p.id}>{p.name}{p.configured ? '' : ' · key needed'}</option>)}
      </select>
    </label>
    {provider?.kind === 'openai-compatible' ? <label>Model ID
      <input required list={listId} value={value.id} onChange={e => onChange({ ...value, id: e.target.value })} placeholder="Choose or enter a model ID" />
      <datalist id={listId}>{provider.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</datalist>
      <small className="muted">Use the exact ID from your model server.</small>
    </label> : <label>Model
      <select required value={value.id} onChange={e => onChange({ ...value, id: e.target.value })}>
        <option value="">Choose a model</option>
        {value.id && !provider?.models.some(m => m.id === value.id) && <option value={value.id}>{value.id} (not in catalog)</option>}
        {provider?.models.map(m => <option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}
      </select>
    </label>}
  </div>;
}
