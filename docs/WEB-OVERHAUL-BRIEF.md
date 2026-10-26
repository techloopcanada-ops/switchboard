# Web UI overhaul brief (for Codex)

From Claude, October 25, 2026. The owner tried the app and said: **it is clunky, chats disappear, I cannot see what I am typing, it will not learn skills.** Core (`packages/core`) is already fixed and committed; the phone app is mine. Your job is `apps/web` only. Do not edit `packages/core/src`; if you need an API change, write it in `research/codex-status.md` and carry on with the closest existing endpoint.

Read first: `packages/core/src/server.ts` (all routes), `packages/core/src/runtime.ts` (`ChatEvent`, `CommandOutcome`, `command()`, `learnFrom()`), `packages/core/src/sessions.ts` (`SessionRow`), then the current `apps/web/src/screens/Chat.tsx`, `App.tsx`, `styles.css`.

Build and test commands (the folder name contains `&`, so never use `npx` or `.bin` shims): from `switchboard/`: `node node_modules/typescript/bin/tsc -p packages/core/tsconfig.json` (core build, only if you need fresh `dist`), `npm run build -w apps/web`, `npm run typecheck -w apps/web`, `node --test` for `apps/web/test`.

## What is wrong today, and why

1. **Chats vanish.** A fresh `web:<uuid>` conversation opens on every launch or reload, and the sidebar only lists the selected bot's conversations (`/api/sessions/list?bot=`), so switching bots hides everything else. Opening a conversation used to create empty "Untitled" rows. Fix: remember the open conversation and list all conversations.
2. **`/bot coder` is sent to the model** as plain text (one real chat has 115 messages of confusion). Slash commands must be answered locally via the new server support.
3. **Approvals live on another screen.** A chat just says "Waiting for tool or approval…" with no way to act. Approvals must appear inline in the chat.
4. **The owner could not see what they typed** (phone, but make the web composer bulletproof too).
5. **It feels clunky:** every region is a bordered card, the chat column is cramped, tool output is noisy, no copy buttons, no way to rename or delete a conversation.

## API changes you can rely on (all live in `packages/core/dist` after build)

- `GET /api/sessions/list` (optional `?bot=`): conversations that have messages, newest first, **across all bots by default**. Rows: `{ id, botId, chatKey, channel, title, createdAt, updatedAt, messageCount, preview }`. `title` is the first user message (60 chars).
- `GET /api/sessions?bot=&chat=`: `{ session: SessionRow | null, messages }`. **Never creates** a conversation; `session` is `null` until the first message is sent.
- `PUT /api/sessions/:id` `{ title }` renames. `DELETE /api/sessions/:id` deletes (aborts a running run). `POST /api/sessions/reset` `{ botId, chatKey }` clears messages but keeps the row.
- **Slash commands**: WebSocket `{type:'chat', id, botId, chatKey, text}` now answers `{type:'command_result', requestId, command:{ reply, switchBot?, newConversation? }}` when `text` is a known command (`/help /bots /bot <id> /new /skills /learn [hint] /usage /status` and any workflow `command` trigger), **without storing it or calling the model**. Unknown `/words` and paths like `/etc/hosts` still go to the model. HTTP `POST /api/chat` returns `{ command: {...} }` for the same.
- **Approvals**: `POST /api/approvals/:id` `{ decision: 'allow'|'deny', by, remember?: true }`; WebSocket `{type:'approve', id, decision, by, remember}`. `remember: true` with `allow` sets that bot's policy for that category to `auto` for good. `ApprovalRequest` has `botId, botName, chatKey, channel, toolName, category, summary, args, createdAt, expiresAt`.
- **Skill suggestions** arrive as approvals with `toolName: 'save_skill'`, `category: 'self-modify'`, `summary: 'Learn skill "name": …'` and `args: { name, description, body }`; they live six hours. Allow saves the skill. WebSocket pushes `{type:'skill_learned', name}` after a save.
- `POST /api/learn` `{ botId, chatKey, hint? }` returns `{ proposed?: {name, description, body}, message }`; the suggestion then shows up as an approval. This is the same as typing `/learn`.
- `GET /api/status` now includes `learning: { auto, minToolCalls }`; `PUT /api/config` accepts `learning` (same shape).
- Chat WebSocket events are unchanged (`start | delta | tool_start | tool_end | done | error`, all carry `runId`; `start` carries `botId`, `chatKey`, `sessionId`). Messages are now saved as each finishes, so `GET /api/sessions` during a run already returns the user message and finished tool steps.

Update `apps/web/src/types.ts` for `command_result`, `skill_learned`, the new `SessionRow` fields (re-exported from core, rebuild core types if needed), and `remember`.

## Required behaviour (acceptance criteria)

**Conversations**
- The open conversation (`botId` + `chatKey`) is saved in `localStorage` and restored on launch, reload and Electron restart. First ever launch opens a new empty conversation with the default bot.
- Sidebar lists all conversations (every bot), grouped Today / Yesterday / Previous 7 days / Older, each row showing the bot emoji, title, one-line preview and time. Search box filters title and preview client-side. Selecting a row opens it **and switches the bot to that conversation's bot**.
- Row menu: Rename (inline, `PUT`), Delete (confirm, `DELETE`). Deleting the open conversation opens a new empty one.
- "New chat" (button and `Ctrl+Shift+O`): generates a new key but does **not** call any endpoint until the first message is sent. The list refreshes after `done`/`error` events, rename, delete.
- Changing the bot in the header starts a new empty conversation with that bot (the previous one stays in the list). The bot selector shows name, emoji and model.
- Drafts are kept per conversation in `localStorage` so switching away and back never loses typed text.

**Composer** (this is the "cannot see what I type" fix)
- Docked at the bottom of the chat column, always visible, never covered by anything. Explicit `color`, `caret-color` and `background` with at least 4.5:1 contrast in light and dark; font size 16px; placeholder visibly lighter than typed text; focus ring.
- Auto-grows from 1 to 8 lines, then scrolls. Enter sends, Shift+Enter inserts a newline, IME composition respected. Never cleared until the server accepted the message; on error the text returns.
- Typing `/` at the start shows a command picker listing the commands above (filter as you type, Up/Down/Tab/Enter). `command_result.reply` renders as a muted note bubble in the transcript (not persisted, labelled "Switchboard"); apply `switchBot` (new empty conversation with that bot) and `newConversation`.
- While a run is active show a Stop button (sends `abort` with the `sessionId` from the `start` event). Focus returns to the composer when the run ends.

**Transcript**
- Centered column, max width about 780px, generous line height. User messages as a right-aligned soft bubble; assistant messages as plain markdown without a heavy card. Code blocks have a language label and a Copy button; each assistant message has Copy. Sanitise markdown as today.
- Tool activity as a compact timeline row per call: `✓ list_dir  .` with a chevron to expand arguments and output; failed calls in red. Group a run's tool rows under the assistant message that made them. Results from stored `toolResult` messages render the same way.
- Streaming text appears progressively. Auto-scroll sticks to the bottom unless the user scrolled up; then show a "Jump to latest" pill.
- Errors appear inline with a Retry button that restores the draft. Show cost and tokens small under the last reply only.

**Inline approvals**
- A pending approval whose `chatKey` matches the open conversation renders as a card at the end of the transcript: bot, summary, category badge, live countdown from `expiresAt`, a "Details" toggle showing `args` (pretty JSON; for `write_file` show the content), and buttons **Allow**, **Always allow** (label: `Always allow <category> for <bot>`; ask `confirm()` first when the category is `shell` or `self-modify`) and **Deny**. Keyboard shortcuts `A` / `D` only when the card is focused.
- `save_skill` approvals render as a "Suggested skill" card instead: show `name`, `description` and the rendered `body`, buttons **Save skill** and **Not now**. Show a toast "Learned: <name>" on `skill_learned`.
- Approvals for other conversations keep appearing on the Approvals screen and in the sidebar count; add the same Always allow button there. The Approvals screen also lists skill suggestions.

**Chat header and menus**
- Header: bot picker, title (click to rename), a "Learn from this chat" button (calls `POST /api/learn`, shows the returned `message` in a toast), and an overflow menu with Clear messages (confirm; label it "Clear", not "Reset"), Delete conversation. Remove the "A workspace for your next idea." line and the Refresh button (the transcript is live).

**Layout and polish**
- Make the whole app feel lighter: fewer boxed cards and borders, a slimmer left nav (icons plus labels, collapsible), the conversation list as a second pane only on the Chat screen, consistent 8px spacing, system font stack, reduced shadows. Works at 360px (phone browsers) with the conversation list as a slide-over. Dark and light both polished; respect `prefers-reduced-motion`.
- Settings → General gets a **Skill learning** section: toggle "Suggest skills automatically after multi-step tasks" and a number field "Suggest after N tool calls" (`PUT /api/config` `{ learning }`), with one sentence explaining that nothing is saved without approval and `/learn` works any time.
- Skills screen: keep, and add a badge for bundled versus yours.

**Do not regress**: auth/bootstrap, the Get started flow, Pair screen, Settings, Bots, Workflows, Memory, keyboard accessibility, the existing `apps/web/test` suite.

## Tests you must add
- Pure functions in `apps/web/src` with `node --test` tests: conversation grouping by date, search filter, draft and current-conversation persistence helpers (inject a fake storage), command-picker filtering, "stick to bottom" decision, countdown formatting.
- Browser verification with a preview daemon (see `apps/web/test/browser-preview.mjs` for how you faked a model before; use `fauxProvider` from `@earendil-works/pi-ai`). Show with screenshots or DOM assertions: (a) type, reload, the conversation and draft are restored; (b) switching bot keeps the old conversation listed; (c) `/bot coder` switches bot and is not sent to the model; (d) an approval card appears inline and Allow lets the run finish; (e) Always allow stops the next prompt; (f) typing a long multi-line message keeps the text visible and the composer on screen at 360px and 1280px, light and dark.

## Reporting
Append to `research/codex-status.md`: what you built, the exact commands you ran, anything you could not verify. Do not commit; Claude reviews, rebuilds the installer and commits. When done, tell the owner in the chat that the web overhaul is ready for Claude to review.
