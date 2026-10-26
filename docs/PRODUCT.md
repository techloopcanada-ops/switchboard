# Switchboard: product spec v1

Codename. Tagline: **Your bots. Any model. Every channel. Approved from your pocket.**

Switchboard is a desktop and server app that runs a set of named AI **bots** on any language model, connects them to the chat apps you already use, lets them do real work on your machine (code, files, shell, web), and puts every risky action behind a one-tap approval on your phone.

## Who it is for

Developers and power users who want a personal agent that is (a) model-agnostic, (b) safe to leave running, and (c) controllable from a phone, without exposing their machine to the internet.

## What is new versus Hermes and OpenClaw

| Capability | Hermes | OpenClaw | Switchboard v1 |
|---|---|---|---|
| Any model | yes | yes | yes, 30+ providers plus Ollama and LM Studio |
| Chat gateways | 6+ | 20+ | Telegram, Discord (long polling, no ports) |
| Multiple named bots with own model, tools, memory and budget | profiles | partial | first-class, switchable per chat with `/bot` |
| Approval gate on tool calls | limited | yes | policy per tool category, phone push, timeout-to-deny |
| Mobile companion | none found | yes, pairing complaints | Android APK first, QR pairing on LAN or Tailscale |
| Declarative workflows in files | cron only | cron only | YAML workflows: cron, command, webhook triggers; deliver anywhere |
| Skills | agentskills.io, self-written | ClawHub | agentskills.io, bots can save new skills behind approval |
| Tutorial bot | no | no | "Guide" bot grounded in live config, optional |

## Core objects

- **Bot**: `{ id, name, emoji, system prompt, model, tools, skills, memory on/off, monthly budget, approval policy, channels }`.
- **Channel**: Telegram chat, Discord channel, web UI session, mobile session. Each maps to a default bot.
- **Session**: ordered messages per (bot, chat key), stored locally in SQLite.
- **Approval**: a pending tool call awaiting allow or deny from any connected surface.
- **Workflow**: YAML file with trigger, bot, prompt, delivery targets and approval mode.
- **Skill**: an agentskills.io directory. Metadata is always in context; the body loads on demand.
- **Memory**: per-bot `MEMORY.md` plus global `USER.md`, injected at session start, editable by the bot through a `remember` tool.

## Security model

- The daemon listens on loopback by default; LAN binding is opt-in for mobile pairing and always token-authenticated.
- Gateways use outbound long polling only. No webhook ports. No relay servers of ours.
- Tool categories: `read`, `write`, `shell`, `network`, `messaging`, `self-modify`. Each bot's policy sets `auto`, `ask` or `never` per category. Default: `read` auto, everything else ask.
- Pending approvals time out to deny after a configurable period.
- The shell tool runs in the bot's working directory with an optional Docker sandbox in a later version.

## Monetization (hypotheses, disclosed to users)

1. Affiliate links in the "Get an API key" and "Run 24/7 on a server" wizards. Candidate programmes with evidence are listed in `docs/MONETIZATION.md`. Every link is labelled as an affiliate link.
2. Optional one-time Pro license later for multi-device sync and team features. Not in v1.
3. GitHub Sponsors button on the repo.

No revenue is forecast. The first 60 days after a public release decide whether to continue (see research memo kill criteria).

## v1 scope (this build)

- Core daemon: models, bots, tools, skills, memory, approvals, sessions, workflows, Telegram and Discord gateways, local API and web UI.
- Desktop: Electron shell around the web UI with tray icon and the daemon in-process.
- Mobile: Expo app for Android first: pair, chat, approvals, push notifications.
- Docs: setup guide, three tutorials, monetization plan, Codex collaboration brief.

## Explicitly excluded from v1

WhatsApp via unofficial libraries, our own relay or cloud sync, voice, browser automation, MCP client, Docker sandbox, iOS build, payments.
