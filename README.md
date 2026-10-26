# Switchboard

**Your bots. Any model. Every channel. Approved from your pocket.**

Switchboard runs a set of named AI bots on your own machine or server. Each bot has its own model (30+ providers through [pi-ai](https://pi.dev), plus Ollama, LM Studio or any OpenAI-compatible endpoint), its own tools, skills, memory, monthly budget and approval policy. Bots answer in the web UI, the desktop app, Telegram, Discord and the Android companion app, and every risky action (writing files, running commands, fetching the web, messaging, self-modification) pauses until a human taps Allow, on any of those surfaces.

It takes the ideas of [Hermes Agent](https://github.com/NousResearch/hermes-agent) (gateways, skills, memory, cron) and the runtime of [pi](https://github.com/earendil-works/pi) (small, typed, provider-agnostic) and adds what neither ships: multiple bots as first-class objects, declarative workflows with approval steps, and a phone remote that pairs by QR code with no inbound ports and no relay.

## Status

Pre-release 0.1.0, built October 25, 2026 by TechLoop with Claude Code and Codex. The core daemon has 17 passing tests; the web UI builds; the Windows desktop installer and an Android test APK build from this tree (see `docs/MOBILE.md`). iOS is not started. Nothing is published to an app store or package registry yet; read the security model below before giving a bot shell access.

## Quick start

```bash
git clone <this repo> && cd switchboard
npm install
npm run build                       # core + web UI
node packages/core/dist/cli.js setup   # provider key, default model, optional Telegram
node packages/core/dist/cli.js start   # http://127.0.0.1:7787
```

Then open the URL, talk to the **Guide** bot, and read `docs/SETUP.md`.

On Windows, if the folder path contains `&`, run tools as `node node_modules/<pkg>/bin/<bin>` instead of `npx`.

## Layout

| Path | What | Owner |
|---|---|---|
| `packages/core` | Daemon: models, bots, tools, skills, memory, approvals, sessions (SQLite), workflows (cron), Telegram and Discord gateways, local API + WebSocket, CLI | Claude |
| `apps/web` | React web UI served by the daemon | Codex |
| `apps/desktop` | Electron shell around the UI with tray and native notifications | Codex |
| `apps/mobile` | Expo app: pair by QR, chat, approvals, push | Claude |
| `docs/` | Product spec, setup, tutorials, mobile, monetization, Codex brief | both |

## Skills and chat commands

Bots save reusable procedures as skills (agentskills.io format) and you approve each one; `/learn`, `/help` and friends work in every chat surface. See `docs/SKILLS-AND-LEARNING.md`.

## Security model

- The API listens on loopback by default and is always token-protected. LAN binding is opt-in for phone pairing.
- Chat gateways use outbound long polling. There are no webhooks and no servers of ours.
- Tool categories `read`, `write`, `shell`, `network`, `messaging`, `self-modify` each have an approval mode per bot: `auto`, `ask` or `never`. Default: read is auto, everything else asks. Unanswered approvals are denied on timeout.
- File tools are confined to the bot's working directory and can never read Switchboard's own configuration. The shell tool is not confined; that is why it asks.

## Monetization

Free and MIT. Affiliate links in the provider and hosting wizards, always labelled. See `docs/MONETIZATION.md` and `research/switchboard-research.md` for the evidence and the kill criteria.

## License and publisher

MIT, copyright TechLoop. Built on MIT and Apache-2.0 dependencies only. Published under the TechLoop identity: app ids `ca.techloop.switchboard`, support and privacy contact in `docs/SUPPORT.md` and `docs/PRIVACY-POLICY.md`.
