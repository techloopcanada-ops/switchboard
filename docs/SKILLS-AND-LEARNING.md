# Skills, learning and chat commands

## What a skill is

A skill is a folder with a `SKILL.md` file: a name, a one-line description of what it does and when to use it, then step-by-step instructions. Bots see only the name and description until a task matches, then load the full text with `load_skill`. Skills live in `~/.switchboard/skills/<name>/SKILL.md` (yours) and ship in `packages/core/skills` (bundled). Yours win when names clash. The format is the open agentskills.io standard, so skills from other tools work here.

## How Switchboard learns

Three ways, all gated by you:

1. **Automatic suggestions.** After a conversation in which a bot did real work with tools (default: 4 or more tool calls, not counting loading skills or saving memory), the bot's own model reviews it and decides whether a reusable procedure came out of it. It saves nothing on its own. If it finds one, a **Suggested skill** card appears in the chat and in Approvals on the web, the phone and Telegram or Discord, with the full steps to read. **Save skill** writes it; **Not now** discards it. Suggestions stay for six hours. One suggestion per conversation per 15 minutes at most.
2. **`/learn`** in any chat (or the menu on the phone, or the button in the web header). Reviews the current conversation immediately. Add a hint to steer it: `/learn the docker steps we just worked out`.
3. **The bot saves it itself.** Bots with the `save_skill` tool (Assistant and Coder) are told to save a skill when they finish a multi-step task you may repeat, and to fix a loaded skill when it turns out wrong. That save is a normal "ask" approval in the `self-modify` category, so you still say yes.

A saved skill is available to every bot immediately, in the same conversation, with no restart. The skills list refreshes on every run.

What a good suggestion contains: the goal, numbered steps with the exact commands, paths and settings that worked, the pitfalls hit and how they were solved, and how to check it worked. Written as instructions to the bot, not as a story.

To turn automatic suggestions off or change the threshold: Settings → General → Skill learning, or in `~/.switchboard/config.json`: `"learning": { "auto": false, "minToolCalls": 6 }`. `/learn` keeps working either way.

Editing and deleting: open the Skills screen in the web UI, or edit the file directly; changes show up on the next message. Delete the skill's folder to remove it.

## Always allow

Every approval card has **Always allow**. It sets that bot's policy for that tool category (for example `write` for Coder) to `auto` and keeps it. It does not affect other bots or categories. For `shell` and `self-modify` the app asks you to confirm first. To undo it, open Bots and set the category back to `ask` (or `never`).

## Chat commands

Commands work the same in the web UI, the phone app, Telegram and Discord, and are answered by Switchboard itself, never sent to the model. Anything else starting with `/` (a file path, say) goes to the model as normal.

| Command | What it does |
|---|---|
| `/help` | List commands |
| `/bots` | List bots; the current one is marked |
| `/bot <id or name>` | Switch to another bot |
| `/new` | Start a new conversation. The old one is kept in your list (in Telegram and Discord it is archived, not deleted) |
| `/skills` | List installed skills |
| `/learn [hint]` | Review this conversation and suggest a skill |
| `/usage` | Spend this month, per bot |
| `/status` | What this installation can do right now |
| `/<name>` | Any workflow with a `command: <name>` trigger runs and replies |

## Conversations are never silently lost

Each message is saved the moment it finishes, so a restart, crash or dropped connection keeps everything up to that point. Opening a conversation never creates one; it exists from the first message. Conversations from every bot appear together in the list, newest first. Deleting is always explicit.
