import {
  InMemoryCredentialStore,
  createModels,
  createProvider,
  envApiKeyAuth,
  type Api,
  type AuthResult,
  type Model,
  type MutableModels,
  type Provider,
  type RefreshModelsContext,
} from '@earendil-works/pi-ai';
import * as openaiCompletions from '@earendil-works/pi-ai/api/openai-completions';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import type { Config, ProviderConfig } from './config.ts';

export interface ProviderSummary {
  id: string;
  name: string;
  kind: 'builtin' | 'openai-compatible';
  configured: boolean;
  source?: string;
  baseUrl?: string;
  models: ModelSummary[];
}

export interface ModelSummary {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  /** USD per million tokens. */
  inputPrice: number;
  outputPrice: number;
}

/** Curated list shown first in the UI. Everything else is still available. */
export const FEATURED_PROVIDERS = ['openrouter', 'anthropic', 'openai', 'google', 'groq', 'together', 'fireworks', 'deepseek', 'xai', 'mistral'];

/**
 * Wraps pi-ai's provider collection: built-in providers plus any OpenAI-compatible server
 * (Ollama, LM Studio, vLLM, a RunPod endpoint) the user adds in config.
 */
export class ModelRegistry {
  readonly models: MutableModels;
  private readonly credentials = new InMemoryCredentialStore();
  private custom = new Map<string, ProviderConfig>();

  constructor() {
    this.models = createModels({ credentials: this.credentials, identity: { attribution: null } });
    for (const provider of builtinProviders()) this.models.setProvider(provider);
  }

  /** Apply provider keys and custom servers from config. Safe to call repeatedly. */
  async applyConfig(config: Config): Promise<void> {
    const seen = new Set<string>();
    for (const [id, cfg] of Object.entries(config.providers)) {
      seen.add(id);
      if (cfg.kind === 'openai-compatible') {
        if (!cfg.baseUrl) continue;
        this.custom.set(id, cfg);
        this.models.setProvider(createCompatibleProvider(id, cfg));
      }
      if (cfg.apiKey) await this.credentials.modify(id, async () => ({ type: 'api_key', key: cfg.apiKey }));
      else await this.credentials.delete(id);
    }
    for (const id of [...this.custom.keys()]) {
      if (!seen.has(id)) {
        this.custom.delete(id);
        this.models.deleteProvider(id);
      }
    }
  }

  isCustom(providerId: string): boolean {
    return this.custom.has(providerId);
  }

  getModel(providerId: string, modelId: string): Model<Api> | undefined {
    const known = this.models.getModel(providerId, modelId);
    if (known) return known;
    const custom = this.custom.get(providerId);
    if (custom?.baseUrl) return compatibleModel(providerId, custom.baseUrl.replace(/\/+$/, ''), modelId);
    return undefined;
  }

  async checkAuth(providerId: string): Promise<AuthResult | undefined> {
    try {
      return await this.models.getAuth(providerId);
    } catch {
      return undefined;
    }
  }

  async refresh(providerIds?: string[]): Promise<Record<string, string>> {
    const result = await this.models.refresh({ allowNetwork: true, providers: providerIds });
    const errors: Record<string, string> = {};
    for (const [id, error] of result.errors) errors[id] = error.message;
    return errors;
  }

  async listProviders(): Promise<ProviderSummary[]> {
    const out: ProviderSummary[] = [];
    for (const provider of this.models.getProviders()) {
      const auth = await this.checkAuth(provider.id);
      const custom = this.custom.get(provider.id);
      out.push({
        id: provider.id,
        name: provider.name,
        kind: custom ? 'openai-compatible' : 'builtin',
        configured: auth !== undefined,
        source: auth?.source,
        baseUrl: custom?.baseUrl ?? provider.baseUrl,
        models: this.models.getModels(provider.id).map(summarize),
      });
    }
    const rank = (id: string) => {
      const i = FEATURED_PROVIDERS.indexOf(id);
      return i === -1 ? FEATURED_PROVIDERS.length : i;
    };
    return out.sort((a, b) => Number(b.configured) - Number(a.configured) || rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  }

  get streamFn() {
    return this.models.streamSimple.bind(this.models);
  }
}

function summarize(model: Model<Api>): ModelSummary {
  return {
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    inputPrice: model.cost.input,
    outputPrice: model.cost.output,
  };
}

function compatibleModel(providerId: string, baseUrl: string, modelId: string): Model<'openai-completions'> {
  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: providerId,
    baseUrl,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

function createCompatibleProvider(id: string, cfg: ProviderConfig): Provider {
  const baseUrl = (cfg.baseUrl as string).replace(/\/+$/, '');
  const name = cfg.name ?? id;
  const envVar = `${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
  return createProvider<'openai-completions'>({
    id,
    name,
    baseUrl,
    auth: {
      apiKey: cfg.apiKey
        ? envApiKeyAuth(`${name} API key`, [envVar])
        // Local servers (Ollama, LM Studio, vLLM) ignore the key, but the OpenAI client needs a non-empty one.
        : { name: `${name} (no key)`, resolve: async () => ({ auth: { apiKey: 'switchboard-local' }, source: 'keyless local server' }) },
    },
    models: [],
    fetchModels: async (context: RefreshModelsContext) => {
      const headers: Record<string, string> = {};
      const key = context.credential?.type === 'api_key' ? context.credential.key : undefined;
      if (key) headers.Authorization = `Bearer ${key}`;
      const response = await fetch(`${baseUrl}/models`, { headers, signal: context.signal });
      if (!response.ok) throw new Error(`${name}: GET /models returned ${response.status}`);
      const body = (await response.json()) as { data?: { id?: string }[] };
      return (body.data ?? []).filter(m => typeof m.id === 'string').map(m => compatibleModel(id, baseUrl, m.id as string));
    },
    api: openaiCompletions,
  });
}
