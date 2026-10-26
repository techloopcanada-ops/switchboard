import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { validateBot } from './bots.ts';
import { isMasked, redactConfig, type Config, type ProviderConfig } from './config.ts';
import { readBotMemory, readUserProfile, writeBotMemory, writeUserProfile } from './memory.ts';
import { AFFILIATE_DISCLOSURE, referralLinks } from './referrals.ts';
import { VERSION, type ChatEvent, type Switchboard } from './runtime.ts';
import { readSkillBody, writeUserSkill } from './skills.ts';
import { deleteWorkflow, saveWorkflowYaml } from './workflows.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ServerHandle {
  server: http.Server;
  url: string;
  close(): Promise<void>;
}

export interface ServerOptions {
  webDir?: string;
  /** Called after config changes that affect channels. */
  onConfigChanged?: (config: Config) => Promise<void> | void;
}

function defaultWebDir(): string {
  if (process.env.SWITCHBOARD_WEB_DIR) return process.env.SWITCHBOARD_WEB_DIR;
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'web', 'dist');
}

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2_000_000) throw new HttpError(413, 'Request body too large.');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Body must be a JSON object.');
  }
}

export function createServer(sb: Switchboard, options: ServerOptions = {}): ServerHandle {
  const webDir = options.webDir ?? defaultWebDir();
  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => {
      const status = error instanceof HttpError ? error.status : 500;
      if (!res.headersSent) sendJson(res, status, { error: (error as Error).message });
      else res.end();
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  function broadcast(message: unknown): void {
    const data = JSON.stringify(message);
    for (const client of clients) if (client.readyState === WebSocket.OPEN) client.send(data);
  }
  sb.on('chat', (event: ChatEvent) => broadcast({ type: 'chat', event }));
  sb.on('approval', request => broadcast({ type: 'approval', request }));
  sb.on('approval_resolved', resolved => broadcast({ type: 'approval_resolved', resolved }));
  sb.on('bots', bots => broadcast({ type: 'bots', bots }));

  function authorized(req: http.IncomingMessage, url: URL): boolean {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token') ?? '';
    return token.length > 0 && safeEqual(token, sb.config.token);
  }

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws' || !authorized(req, url)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      clients.add(ws);
      ws.send(JSON.stringify({ type: 'hello', version: VERSION, bots: sb.listBots(), approvals: sb.approvals.list() }));
      ws.on('close', () => clients.delete(ws));
      ws.on('message', raw => {
        let message: Record<string, unknown>;
        try { message = JSON.parse(String(raw)) as Record<string, unknown>; } catch { return; }
        void handleSocketMessage(ws, message);
      });
    });
  });

  async function handleSocketMessage(ws: WebSocket, message: Record<string, unknown>): Promise<void> {
    const reply = (payload: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); };
    try {
      switch (message.type) {
        case 'ping': reply({ type: 'pong', t: Date.now() }); break;
        case 'chat': {
          const { botId, chatKey, text } = message as { botId?: string; chatKey?: string; text?: string };
          if (!botId || !chatKey || typeof text !== 'string' || !text.trim()) throw new Error('chat needs botId, chatKey and text.');
          const result = await sb.chat({ botId, chatKey, channel: chatKey.split(':')[0] ?? 'web', text });
          reply({ type: 'chat_result', requestId: message.id, result });
          break;
        }
        case 'approve': {
          const { id, decision, by } = message as { id?: string; decision?: string; by?: string };
          if (!id || (decision !== 'allow' && decision !== 'deny')) throw new Error('approve needs id and decision.');
          reply({ type: 'approve_result', id, ok: sb.approvals.decide(id, decision, by ?? 'ws') });
          break;
        }
        case 'abort': {
          const { sessionId } = message as { sessionId?: string };
          reply({ type: 'abort_result', ok: sessionId ? sb.abort(sessionId) : false });
          break;
        }
        default: throw new Error(`Unknown message type ${String(message.type)}.`);
      }
    } catch (error) {
      reply({ type: 'error', requestId: message.id, message: (error as Error).message });
    }
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (!url.pathname.startsWith('/api/')) { serveStatic(url.pathname, res); return; }
    if (url.pathname === '/api/bootstrap') {
      if (!isLoopback(req.socket.remoteAddress)) throw new HttpError(403, 'Bootstrap is only available from this machine.');
      sendJson(res, 200, { token: sb.config.token, version: VERSION });
      return;
    }
    if (!authorized(req, url)) throw new HttpError(401, 'Missing or invalid token.');
    const method = req.method ?? 'GET';
    const parts = url.pathname.slice('/api/'.length).split('/').filter(Boolean);
    const [head, second, third] = parts;

    if (head === 'status' && method === 'GET') {
      const providers = Object.keys(sb.config.providers);
      sendJson(res, 200, {
        version: VERSION, uptimeSec: Math.round((Date.now() - sb.startedAt) / 1000), bots: sb.listBots(), providersConfigured: providers,
        defaultModel: sb.config.defaultModel ?? null, channels: sb.channelIds(), approvals: sb.approvals.list(), devices: sb.config.devices.length,
        pair: sb.pairingInfo(), guideBot: sb.config.guideBot, workdir: sb.config.workdir,
      });
      return;
    }
    if (head === 'config') {
      if (method === 'GET') { sendJson(res, 200, redactConfig(sb.config)); return; }
      if (method === 'PUT') {
        const body = await readJson(req);
        const patch = sanitizeConfigPatch(sb.config, body);
        const next = await sb.updateConfig(patch);
        await options.onConfigChanged?.(next);
        sendJson(res, 200, redactConfig(next));
        return;
      }
    }
    if (head === 'providers' && method === 'GET') {
      let errors: Record<string, string> = {};
      if (url.searchParams.get('refresh') === '1') errors = await sb.registry.refresh(Object.keys(sb.config.providers));
      sendJson(res, 200, { providers: await sb.registry.listProviders(), errors });
      return;
    }
    if (head === 'bots') {
      if (method === 'GET' && !second) { sendJson(res, 200, sb.listBots()); return; }
      if (method === 'PUT' && second) {
        const body = await readJson(req);
        const bot = validateBot({ ...body, id: second });
        sendJson(res, 200, sb.upsertBot(bot));
        return;
      }
      if (method === 'DELETE' && second) {
        const { deleteBot } = await import('./bots.ts');
        const ok = deleteBot(second);
        sb.reloadBots();
        sendJson(res, ok ? 200 : 404, { ok });
        return;
      }
    }
    if (head === 'sessions') {
      if (method === 'GET' && second === 'list') { sendJson(res, 200, sb.store.listSessions(url.searchParams.get('bot') ?? undefined)); return; }
      if (method === 'GET' && !second) {
        const botId = url.searchParams.get('bot');
        const chatKey = url.searchParams.get('chat');
        if (!botId || !chatKey) throw new HttpError(400, 'bot and chat query parameters are required.');
        if (!sb.getBot(botId)) throw new HttpError(404, 'Unknown bot.');
        const session = sb.store.getOrCreateSession(botId, chatKey, chatKey.split(':')[0] ?? 'web');
        sendJson(res, 200, { session, messages: sb.store.loadMessages(session.id) });
        return;
      }
      if (method === 'POST' && second === 'reset') {
        const body = await readJson(req) as { botId?: string; chatKey?: string };
        if (!body.botId || !body.chatKey) throw new HttpError(400, 'botId and chatKey are required.');
        const session = sb.store.getOrCreateSession(body.botId, body.chatKey, body.chatKey.split(':')[0] ?? 'web');
        sb.store.resetSession(session.id);
        sendJson(res, 200, { ok: true });
        return;
      }
    }
    if (head === 'chat' && method === 'POST') {
      const body = await readJson(req) as { botId?: string; chatKey?: string; text?: string };
      if (!body.botId || !body.chatKey || !body.text?.trim()) throw new HttpError(400, 'botId, chatKey and text are required.');
      sendJson(res, 200, await sb.chat({ botId: body.botId, chatKey: body.chatKey, channel: body.chatKey.split(':')[0] ?? 'web', text: body.text }));
      return;
    }
    if (head === 'abort' && method === 'POST') {
      const body = await readJson(req) as { sessionId?: string };
      sendJson(res, 200, { ok: body.sessionId ? sb.abort(body.sessionId) : false });
      return;
    }
    if (head === 'approvals') {
      if (method === 'GET' && !second) { sendJson(res, 200, sb.approvals.list()); return; }
      if (method === 'GET' && second === 'log') { sendJson(res, 200, sb.store.recentApprovals()); return; }
      if (method === 'POST' && second) {
        const body = await readJson(req) as { decision?: string; by?: string };
        if (body.decision !== 'allow' && body.decision !== 'deny') throw new HttpError(400, 'decision must be allow or deny.');
        sendJson(res, 200, { ok: sb.approvals.decide(second, body.decision, body.by ?? 'api') });
        return;
      }
    }
    if (head === 'skills') {
      if (method === 'GET' && !second) { sendJson(res, 200, sb.listSkills()); return; }
      if (method === 'POST' && second === 'reload') { sendJson(res, 200, sb.reloadSkills()); return; }
      if (method === 'GET' && second) {
        const skill = sb.listSkills().find(s => s.name === second);
        if (!skill) throw new HttpError(404, 'Unknown skill.');
        sendJson(res, 200, { ...skill, body: readSkillBody(skill) });
        return;
      }
      if (method === 'PUT' && second) {
        const body = await readJson(req) as { description?: string; body?: string };
        if (!body.description || typeof body.body !== 'string') throw new HttpError(400, 'description and body are required.');
        writeUserSkill(second, body.description, body.body);
        sendJson(res, 200, sb.reloadSkills());
        return;
      }
    }
    if (head === 'workflows') {
      if (method === 'GET' && !second) { sendJson(res, 200, sb.listWorkflows()); return; }
      if (method === 'GET' && second) {
        const workflow = sb.listWorkflows().workflows.find(w => w.name === second);
        if (!workflow) throw new HttpError(404, 'Unknown workflow.');
        sendJson(res, 200, { ...workflow, yaml: fs.readFileSync(workflow.file, 'utf8') });
        return;
      }
      if (method === 'PUT' && second) {
        const body = await readJson(req) as { yaml?: string };
        if (typeof body.yaml !== 'string') throw new HttpError(400, 'yaml is required.');
        saveWorkflowYaml(second, body.yaml);
        sendJson(res, 200, sb.reloadWorkflows());
        return;
      }
      if (method === 'DELETE' && second) {
        const ok = deleteWorkflow(second);
        sb.reloadWorkflows();
        sendJson(res, ok ? 200 : 404, { ok });
        return;
      }
      if (method === 'POST' && second && third === 'run') {
        const workflow = sb.listWorkflows().workflows.find(w => w.name === second);
        if (!workflow) throw new HttpError(404, 'Unknown workflow.');
        sendJson(res, 200, await sb.runWorkflow(workflow, 'manual'));
        return;
      }
    }
    if (head === 'memory') {
      const botId = url.searchParams.get('bot');
      if (method === 'GET') { sendJson(res, 200, { text: botId ? readBotMemory(botId) : readUserProfile() }); return; }
      if (method === 'PUT') {
        const body = await readJson(req) as { text?: string };
        if (typeof body.text !== 'string') throw new HttpError(400, 'text is required.');
        if (botId) writeBotMemory(botId, body.text); else writeUserProfile(body.text);
        sendJson(res, 200, { ok: true });
        return;
      }
    }
    if (head === 'usage' && method === 'GET') { sendJson(res, 200, sb.usage()); return; }
    if (head === 'pair' && method === 'GET') { sendJson(res, 200, sb.pairingInfo()); return; }
    if (head === 'devices') {
      if (method === 'GET') { sendJson(res, 200, redactConfig(sb.config).devices); return; }
      if (method === 'POST') {
        const body = await readJson(req) as { name?: string; expoPushToken?: string };
        if (!body.expoPushToken || !/^Expo(nent)?PushToken\[.+\]$/.test(body.expoPushToken)) throw new HttpError(400, 'A valid Expo push token is required.');
        const devices = sb.config.devices.filter(d => d.expoPushToken !== body.expoPushToken);
        const device = { id: Math.random().toString(36).slice(2, 10), name: (body.name ?? 'Phone').slice(0, 60), expoPushToken: body.expoPushToken, addedAt: Date.now() };
        await sb.updateConfig({ devices: [...devices, device] });
        sendJson(res, 200, { ok: true, id: device.id });
        return;
      }
      if (method === 'DELETE' && second) {
        await sb.updateConfig({ devices: sb.config.devices.filter(d => d.id !== second) });
        sendJson(res, 200, { ok: true });
        return;
      }
    }
    if (head === 'referrals' && method === 'GET') { sendJson(res, 200, { disclosure: AFFILIATE_DISCLOSURE, links: referralLinks(sb.config.referralCodes) }); return; }
    if (head === 'channels' && method === 'GET') { sendJson(res, 200, { connected: sb.channelIds() }); return; }
    if (head === 'channels' && method === 'POST' && second === 'restart') { await options.onConfigChanged?.(sb.config); sendJson(res, 200, { connected: sb.channelIds() }); return; }
    throw new HttpError(404, `No route for ${method} ${url.pathname}`);
  }

  function serveStatic(pathname: string, res: http.ServerResponse): void {
    const root = path.resolve(webDir);
    if (!fs.existsSync(path.join(root, 'index.html'))) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><title>Switchboard</title><body style="font-family:system-ui;padding:2rem"><h1>Switchboard ${VERSION}</h1><p>The web UI is not built yet. Run <code>npm run build</code> in the switchboard folder, then reload.</p><p>The API is live at <code>/api/status</code>.</p></body>`);
      return;
    }
    let file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600' });
    fs.createReadStream(file).pipe(res);
  }

  const { host, port } = sb.config.server;
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
  return {
    server,
    url,
    close: () => new Promise(resolve => {
      for (const client of clients) client.close();
      wss.close();
      server.close(() => resolve());
    }),
  };
}

export function listen(handle: ServerHandle, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    handle.server.once('error', reject);
    handle.server.listen(port, host, () => resolve());
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Accept a config patch from a UI; masked secrets keep their stored values. */
export function sanitizeConfigPatch(current: Config, body: Record<string, unknown>): Partial<Config> {
  const patch: Partial<Config> = {};
  if (body.providers && typeof body.providers === 'object') {
    const providers: Record<string, ProviderConfig> = {};
    for (const [id, raw] of Object.entries(body.providers as Record<string, Record<string, unknown>>)) {
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) throw new HttpError(400, `Invalid provider id "${id}".`);
      const existing = current.providers[id];
      const kind = raw.kind === 'openai-compatible' ? 'openai-compatible' : 'builtin';
      const apiKey = typeof raw.apiKey === 'string' && raw.apiKey && !isMasked(raw.apiKey) ? raw.apiKey : (raw.apiKey === '' ? undefined : existing?.apiKey);
      const baseUrl = typeof raw.baseUrl === 'string' && raw.baseUrl ? raw.baseUrl : undefined;
      if (kind === 'openai-compatible' && !baseUrl) throw new HttpError(400, `Provider "${id}" needs a baseUrl.`);
      providers[id] = { kind, name: typeof raw.name === 'string' ? raw.name : existing?.name, apiKey, baseUrl };
    }
    patch.providers = providers;
  }
  if (body.defaultModel && typeof body.defaultModel === 'object') {
    const m = body.defaultModel as { provider?: unknown; id?: unknown };
    if (typeof m.provider === 'string' && typeof m.id === 'string') patch.defaultModel = { provider: m.provider, id: m.id };
  }
  if (typeof body.defaultBot === 'string') patch.defaultBot = body.defaultBot;
  if (typeof body.approvalTimeoutSec === 'number' && body.approvalTimeoutSec >= 5 && body.approvalTimeoutSec <= 86400) patch.approvalTimeoutSec = Math.round(body.approvalTimeoutSec);
  if (typeof body.guideBot === 'boolean') patch.guideBot = body.guideBot;
  if (typeof body.workdir === 'string' && body.workdir.trim()) patch.workdir = body.workdir.trim();
  if (body.server && typeof body.server === 'object') {
    const s = body.server as { host?: unknown; port?: unknown };
    patch.server = {
      host: typeof s.host === 'string' && /^[0-9a-fA-F.:]+$/.test(s.host) ? s.host : current.server.host,
      port: typeof s.port === 'number' && s.port >= 1024 && s.port <= 65535 ? Math.round(s.port) : current.server.port,
    };
  }
  if (body.telegram === null) patch.telegram = undefined;
  else if (body.telegram && typeof body.telegram === 'object') {
    const t = body.telegram as { token?: unknown; allowedUserIds?: unknown; defaultBot?: unknown };
    const token = typeof t.token === 'string' && t.token && !isMasked(t.token) ? t.token : current.telegram?.token;
    if (!token) throw new HttpError(400, 'Telegram needs a bot token.');
    const ids = Array.isArray(t.allowedUserIds) ? t.allowedUserIds.map(Number).filter(n => Number.isInteger(n) && n > 0) : current.telegram?.allowedUserIds ?? [];
    patch.telegram = { token, allowedUserIds: ids, defaultBot: typeof t.defaultBot === 'string' ? t.defaultBot : current.telegram?.defaultBot };
  }
  if (body.discord === null) patch.discord = undefined;
  else if (body.discord && typeof body.discord === 'object') {
    const d = body.discord as { token?: unknown; allowedUserIds?: unknown; defaultBot?: unknown };
    const token = typeof d.token === 'string' && d.token && !isMasked(d.token) ? d.token : current.discord?.token;
    if (!token) throw new HttpError(400, 'Discord needs a bot token.');
    const ids = Array.isArray(d.allowedUserIds) ? d.allowedUserIds.map(String).filter(s => /^\d{5,30}$/.test(s)) : current.discord?.allowedUserIds ?? [];
    patch.discord = { token, allowedUserIds: ids, defaultBot: typeof d.defaultBot === 'string' ? d.defaultBot : current.discord?.defaultBot };
  }
  if (body.referralCodes && typeof body.referralCodes === 'object') {
    const codes: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.referralCodes as Record<string, unknown>)) if (typeof v === 'string' && /^[A-Za-z0-9_-]{0,64}$/.test(v)) codes[k] = v;
    patch.referralCodes = codes;
  }
  return patch;
}
