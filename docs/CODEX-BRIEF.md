# Codex brief: Switchboard web UI, desktop shell and tutorials

Written by Claude Code (Fable 5.1) on October 25, 2026. Claude owns `packages/core` (done, tests pass), `apps/mobile` (Expo, in progress) and verification. **Codex owns `apps/web`, `apps/desktop` and `docs/SETUP.md` + `docs/TUTORIALS.md`.** Do not edit `packages/core/src` without leaving a note in `research/codex-status.md`; propose API changes there instead.

Read first: `docs/PRODUCT.md`, `research/switchboard-research.md`, `packages/core/src/server.ts` (the API), `packages/core/src/runtime.ts` (ChatEvent types), `packages/core/src/bots.ts`, `packages/core/src/config.ts`.

## Ground rules

- TypeScript, strict. `apps/web` is already an npm workspace with React 19, Vite 6, `marked`, `dompurify`, `qrcode` in `package.json` (installed). Run commands as `node ../../node_modules/<pkg>/bin/<bin>` if `npx` fails: the folder name contains `&`, which breaks npm's cmd shims.
- No new runtime dependencies without a line in `research/codex-status.md` saying why.
- Design: calm, dense, keyboard-friendly, works at 360 px wide. Light and dark via `prefers-color-scheme`. No external fonts or CDNs. Make it feel like a product, not a demo: empty states, loading states, error toasts, confirm on delete.
- Every affiliate link must show the word "affiliate" next to it and the disclosure text from `GET /api/referrals`.

## 1. Web UI (`apps/web`)

Single-page app served by the daemon at `http://127.0.0.1:7787` (Vite dev server proxies `/api` and `/ws` to it). Files: `index.html`, `vite.config.ts` (proxy, `base: './'`), `tsconfig.json`, `src/main.tsx`, `src/api.ts`, `src/ws.ts`, `src/App.tsx`, `src/screens/*.tsx`, `src/styles.css`.

### Auth
On load call `GET /api/bootstrap` (no auth; only works from loopback) to get `{ token }`. Store it in memory and `localStorage`. If bootstrap fails (remote browser), show a token entry field. Send `Authorization: Bearer <token>` on every request. WebSocket: `ws://host/ws?token=<token>`.

### Screens (left nav on desktop, bottom tabs on phone width)
1. **Chat**: bot picker (from `GET /api/bots`), conversation list (`GET /api/sessions/list?bot=`), transcript (`GET /api/sessions?bot=&chat=`; messages are pi-ai `Message` objects: user/assistant/toolResult; render assistant `content[].type === 'text'` as markdown via marked + DOMPurify, show toolCall blocks as compact chips, toolResult messages collapsed), composer, streaming via WS. New chat = pick a new `chatKey` like `web:<uuid>`. "Reset" calls `POST /api/sessions/reset`. Abort button sends `{type:'abort', sessionId}` over WS. Cost and tokens from the `done` event shown under the reply.
2. **Approvals**: list from `GET /api/approvals` plus live `approval` / `approval_resolved` WS events; Allow / Deny buttons `POST /api/approvals/:id {decision}`; countdown to `expiresAt`; history from `GET /api/approvals/log`. Play a soft sound and set `document.title` to "(1) Approval needed" when one arrives.
3. **Bots**: cards; editor form with all `Bot` fields (`packages/core/src/bots.ts`): id (immutable after create), name, emoji, description, system prompt (textarea), model (provider select from `GET /api/providers`, then model select filtered to that provider; free-text fallback for OpenAI-compatible providers), thinking level, tools (checkbox list from the names in `packages/core/src/tools.ts`, or "all"), skills (all or list from `GET /api/skills`), memory toggle, monthly budget USD, policy grid (6 categories × auto/ask/never), workdir. Save = `PUT /api/bots/:id`. Delete = `DELETE /api/bots/:id` with confirm. Show monthly spend per bot from `GET /api/usage`.
4. **Workflows**: list from `GET /api/workflows` with next run times and parse errors; YAML editor (`PUT /api/workflows/:name {yaml}`), run now (`POST /api/workflows/:name/run`), delete. Provide a "New from template" with the cron example in `packages/core/src/workflows.ts` `workflowToYaml`.
5. **Skills**: list (name, description, source), view body (`GET /api/skills/:name`), create or edit user skills (`PUT /api/skills/:name {description, body}`), reload button.
6. **Memory**: edit `USER.md` (`GET/PUT /api/memory`) and per-bot `MEMORY.md` (`?bot=`).
7. **Settings**: three sections.
   - Providers: table of `GET /api/providers` (configured flag, source, model count); add key for a built-in provider; add an OpenAI-compatible provider (id, name, baseUrl, optional key: Ollama preset `http://localhost:11434/v1`, LM Studio preset `http://localhost:1234/v1`); "Refresh models" (`GET /api/providers?refresh=1`); default model picker. Save via `PUT /api/config` with the shape accepted by `sanitizeConfigPatch` in `server.ts` (masked secrets are kept when sent back unchanged).
   - Channels: Telegram token + allowed user ids + default bot; Discord token + allowed user ids + default bot; "Restart channels" (`POST /api/channels/restart`); show connected list from `GET /api/channels`. Include the step-by-step for BotFather and the Discord Developer Portal inline.
   - General: approval timeout, Guide bot on/off, working directory, server host (127.0.0.1 or 0.0.0.0 with a warning that 0.0.0.0 exposes the token-protected API on the LAN), port, referral codes (one input per programme id from `GET /api/referrals`).
8. **Pair**: QR code (use `qrcode` to render) encoding `switchboard://pair?url=<encoded url>&token=<token>` for each URL in `GET /api/pair`, plus the raw text to copy. Explain: phone on the same network or Tailscale; server host must be 0.0.0.0. List paired devices (`GET /api/devices`) with remove.
9. **Get started** (shown until a default model exists): three steps with buttons: choose a provider (show the inference programmes from `GET /api/referrals` with their disclosure and reward text), set a default model, say hello to the Guide bot. A "Run 24/7 on a server" card with the hosting programmes and a short copy-paste install snippet (`npm install -g @switchboard/core` is not published yet; use `git clone` + `npm install` + `npm run build` + `node packages/core/dist/cli.js start`).

### WS protocol (from `server.ts`)
Server → client: `{type:'hello', version, bots, approvals}`, `{type:'chat', event}` where `event` is a `ChatEvent` (`start | delta | tool_start | tool_end | done | error`, each with `runId`), `{type:'approval', request}`, `{type:'approval_resolved', resolved}`, `{type:'bots', bots}`, `{type:'chat_result', requestId, result}`, `{type:'approve_result'}`, `{type:'abort_result'}`, `{type:'error', requestId, message}`.
Client → server: `{type:'chat', id, botId, chatKey, text}`, `{type:'approve', id, decision, by}`, `{type:'abort', sessionId}`, `{type:'ping'}`.
Chat events are broadcast to every client; filter by the `runId` returned in the `start` event whose `chatKey` matches the open conversation.

### Done means
`npm run build -w apps/web` produces `apps/web/dist`; `npm run typecheck` passes; the daemon serves the UI; every screen above works against the live API; no console errors.

## 2. Desktop shell (`apps/desktop`)

Electron app that starts the daemon in-process and opens the UI.
- `package.json` with `electron` and `electron-builder` as devDependencies (add `apps/desktop` to the root `workspaces` once installed; keep Electron out of the core package).
- `main.ts` (compile with tsc to `dist/main.js`): on ready, `await startSwitchboard({ webDir: <path to apps/web/dist>, log })` from `@switchboard/core`, create a `BrowserWindow` (1280×820, `autoHideMenuBar`), load `app.url`, tray icon with Open / Pause channels / Quit, single-instance lock, `before-quit` calls `app.stop()`. Approval events: show a native `Notification` with the summary; clicking focuses the window on the Approvals screen (`app.url + '/#/approvals'`).
- `electron-builder.yml`: Windows NSIS (x64), appId `app.switchboard.desktop`, product name Switchboard, extraResources for `apps/web/dist` and `packages/core/skills`.
- Done means: `npm run start -w apps/desktop` opens the window with the real UI; `npm run dist -w apps/desktop` produces an installer in `apps/desktop/release`.

## 3. Tutorials (`docs/SETUP.md`, `docs/TUTORIALS.md`)

Audience: a developer who has never run an agent. Short sentences, numbered steps, exact commands, screenshots not required.
- SETUP.md: install Node 22.19+, clone, `npm install`, `npm run build`, `node packages/core/dist/cli.js setup`, `start`, open the UI, add a provider (OpenRouter or Ollama), pick a default model, talk to Guide. Then Telegram in 5 steps, Discord in 7 steps, pairing the phone, running 24/7 on a VPS (with the affiliate disclosure), security notes (token, 0.0.0.0, approvals, workdir sandboxing, what the shell tool can do).
- TUTORIALS.md: (1) "Your first coding task with Coder" including approving a write from the phone; (2) "A morning briefing workflow delivered to Telegram" using a cron workflow; (3) "Teach a bot a skill" using `save_skill` and `load_skill`; (4) "Cheap models for cheap tasks": two bots on different providers with budgets.

## Reporting
Write progress and any blockers to `research/codex-status.md` (what you built, what you could not verify, exact commands you ran). Claude will review that file and run the builds.
