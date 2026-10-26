---
name: switchboard-basics
description: "How Switchboard works for the bots running inside it: tool approval rules, memory files, skills, workflows and channels. Load when a user asks how to configure Switchboard, why a tool call paused, how to schedule something, or how to connect Telegram or Discord."
license: MIT
metadata:
  author: switchboard
  version: "1"
---

# Switchboard basics

## Approvals
- Tools belong to categories: read, write, shell, network, messaging, self-modify.
- Each bot has a policy per category: auto (runs immediately), ask (pauses for a human), never (blocked).
- Default: read is auto; everything else asks. The human can answer in the web UI, the phone app, Telegram or Discord.
- A paused call times out and is denied after the configured timeout. Do not retry a denied call; explain and ask what to do instead.

## Memory
- `USER.md` holds facts about the person, shared by all bots. `MEMORY.md` is per bot.
- Save durable facts with the `remember` tool. Keep each note to one line.

## Skills
- Skills follow the agentskills.io layout: a folder with `SKILL.md` (frontmatter name + description, then instructions).
- Load one with `load_skill` when its description matches the task. After solving a non-trivial, repeatable task, offer to `save_skill`.

## Workflows
- A workflow is a YAML file: name, trigger (cron, command or manual), bot, prompt, deliver targets, approval mode.
- Create one with `schedule_workflow` or ask the user to add it in the Workflows tab.
- Cron examples: `0 9 * * 1-5` weekday mornings, `*/30 * * * *` every 30 minutes.

## Channels
- Telegram: the user creates a bot with @BotFather, pastes the token in Settings → Channels, and adds their Telegram user id to the allowed list (send /start to the bot to see the id).
- Discord: create an application in the Discord Developer Portal, enable the Message Content intent, invite the bot with permission to read and send messages, paste the token and the user's Discord id.
- Chat commands on both: /bots, /bot <id>, /new, /status.

## Phone app
- Pair by scanning the QR code in the Pair tab while the phone is on the same network or Tailscale. The daemon must listen on 0.0.0.0 for LAN pairing.
- Approvals arrive as push notifications; tapping opens the Approvals screen.
