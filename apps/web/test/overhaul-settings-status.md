# Web overhaul: conversations, approvals and learning

Date: October 25, 2026. Subtask scope: web files only. No core source changes, dependency additions, or commits.

## Implemented

- `src/conversations.ts`: current-conversation persistence, per-bot/per-conversation drafts, safe unavailable-storage behavior, local-calendar grouping, title/preview search, and countdown formatting through six-hour skill suggestions. Uses the existing `conversationKey` helper.
- `test/conversations.test.ts`: seven tests for reload persistence, malformed records, isolated exact drafts, unavailable storage and throwing property getters, local day/week boundaries including year and DST boundaries, search, and countdown edges.
- `src/ApprovalCard.tsx`: one shared normal/skill approval UI. Supports Allow, category-specific Always allow and Deny; confirmation before remembering shell or self-modify permission; A/D only when the card itself is focused; ignores repeats, IME, and modifier combinations; busy/resolved/expired states; live countdown; pretty argument JSON and readable write-file contents; rendered Markdown skill body with Save skill / Not now.
- `src/screens/Approvals.tsx`: reuses ApprovalCard and preserves refreshed decision history.
- `src/screens/Settings.tsx`: General → Skill learning toggle, 1–50 tool-call threshold, approval explanation, and `learning` config patch. Parent corrected default-model explanatory copy after we identified the updated core migration behavior.
- `src/screens/Skills.tsx`: source badge now says Yours or Bundled.
- `test/api-smoke.test.mjs`: retains previous coverage and adds updated core contract checks listed below.

## Verification

- `node --test test/conversations.test.ts`: 7/7 pass.
- Same conversation tests with `TZ=America/Toronto`: 7/7 pass, including local DST boundaries.
- `node --test test/api-smoke.test.mjs`: 16/16 pass. Uses real `startSwitchboard`, isolated temporary home, loopback model discovery, and pi-ai's faux model; no paid requests, real channel messages, or device pushes.
- Combined conversation/picker/live-API regression run: 26/26 pass.
- New API checks: unopened GET/reset creates no session; nonempty all-bot listings include previews/counts; rename/delete; WS `/bot coder` and `/new` command results plus HTTP `/help` leave faux model call count and transcripts unchanged; learning config roundtrip; remembered approval persists only the chosen category; `/api/learn` creates a six-hour suggestion, saves only after Allow, and emits `skill_learned` with the expected saved body.
- Intermediate strict TypeScript checks had no diagnostics in this subtask's files. First check was awaiting the other agent's Markdown component. Second check saw in-progress parent/other-agent integration diagnostics in App/types/Transcript; parent owns the final integrated build/typecheck.
- Parent owns visual/browser acceptance checks. No new API requirement or blocker found.

## Exact shell command ledger

Source inspection from workspace root:

```powershell
Get-Content switchboard/docs/WEB-OVERHAUL-BRIEF.md; Get-Content switchboard/apps/web/src/screens/Approvals.tsx; Get-Content switchboard/apps/web/src/screens/Skills.tsx; Get-Content switchboard/apps/web/src/chat-state.ts; Get-Content switchboard/apps/web/src/types.ts; Get-Content switchboard/packages/core/src/approvals.ts; Get-Content switchboard/packages/core/src/config.ts -First 120; rg -n 'approvals|learn|skill_suggestion|remember' switchboard/packages/core/src/server.ts switchboard/packages/core/src/runtime.ts
Get-Content switchboard/packages/core/src/sessions.ts -First 40; Get-Content switchboard/packages/core/src/server.ts | Select-Object -Skip 195 -First 90; Get-Content switchboard/packages/core/src/runtime.ts | Select-Object -Skip 460 -First 35; Get-Content switchboard/apps/web/src/screens/Settings.tsx; Get-Content switchboard/apps/web/src/resource.tsx; Get-Content switchboard/apps/web/src/screens/Chat.tsx -First 70; Get-Content switchboard/apps/web/src/App.tsx -First 35; Get-Content switchboard/apps/web/src/styles.css -First 6
rg -n 'general|approvalTimeout|Guide tutorial' switchboard/apps/web/src/screens/Settings.tsx; Get-Content switchboard/apps/web/src/resource.tsx
Get-Content switchboard/apps/web/test/api-smoke.test.mjs; Get-Content switchboard/packages/core/src/runtime.ts | Select-Object -Skip 375 -First 68; Get-Content switchboard/packages/core/src/learning.ts -First 115; Get-Content switchboard/packages/core/test/learning.test.ts -First 150
rg -n -A 50 'function fauxProvider|interface FauxProvider|type FauxProvider' switchboard/node_modules/@earendil-works/pi-ai/dist; rg -n 'learning|command_result' switchboard/packages/core/dist/config.d.ts switchboard/packages/core/dist/server.js
rg -n -A 30 'interface FauxProviderState|interface FauxProviderHandle' switchboard/node_modules/@earendil-works/pi-ai/dist/providers/faux.d.ts; Get-Content switchboard/packages/core/src/runtime.ts | Select-Object -Skip 125 -First 59
rg -n 'opening an empty|six-hour|learning:|Default model saved|Existing bots|previous default' switchboard/apps/web/test/api-smoke.test.mjs switchboard/apps/web/src/screens/Settings.tsx
```

The guessed `packages/core/test/learning.test.ts` path did not exist; the relevant behavior was verified from runtime/learning source and the new live API test instead. The broad first faux-provider search included source maps and was narrowed to its `.d.ts` file in the next command.

Verification from `switchboard/apps/web`:

```powershell
node --test test/conversations.test.ts
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
$env:TZ = 'America/Toronto'; node --test test/conversations.test.ts
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node --test test/api-smoke.test.mjs
node --test test/conversations.test.ts test/settings.test.mjs test/api-smoke.test.mjs
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

Source writes used `apply_patch`. One combined patch was rejected atomically because the parent's default-model wording fix had already changed the expected Settings line. No partial writes remained; the API-test-only patch was reapplied successfully.

## Follow-up: reachable unsent drafts

Added `listDrafts(storage)` to enumerate nonblank local drafts as `{ botId, chatKey, text }` without creating server sessions. It preserves exact text, ignores unrelated/malformed keys, and tolerates unavailable enumeration or storage. Optional `key`/`length` support preserves the existing injectable storage contract. Added cross-bot draft enumeration and blocked-enumeration tests; conversation tests now total 9 and pass. Parent owns Chat/ConversationList wiring.

Additional command from `switchboard/apps/web` (run twice, before and after ensuring the blocked-enumeration fixture contains a draft):

```powershell
node --test test/conversations.test.ts
```

## October 26 handoff review and race fixes

Fresh review against `docs/HANDOFF-CODEX.md` and `docs/WEB-OVERHAUL-BRIEF.md` found and fixed two concrete races, with parent authorization:

1. Before the initial conversation list returned, a draft belonging to an existing chat could appear under Drafts and open without loading its history. `filterUnsentDrafts` now requires a successful known session list before showing a draft as an empty chat. Stored text is preserved. A regression test covers unresolved, known-existing, and confirmed-empty session lists.
2. A delayed approvals GET could overwrite newer WebSocket approvals or resurrect resolved cards. Both startup and explicit refresh now use one request-generation guard. Live hello/approval/resolution events and effect cleanup invalidate outstanding snapshots. Tests cover delayed startup, resolved requests, out-of-order refreshes, cleanup and propagated load errors.

Hidden-chat focus review: completion increments a focus counter, but Composer only focuses when `visible` is true. No concrete hidden-chat focus-steal defect was found.

Changed files for these fixes: `src/App.tsx`, `src/screens/Chat.tsx`, `src/conversations.ts`, new `src/approval-snapshots.ts`, new `test/approval-snapshots.test.ts`, `test/conversations.test.ts`. No core changes or dependency additions.

Exact verification commands, from `apps/web`:

```powershell
node --test test/conversations.test.ts test/approval-snapshots.test.ts
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node --test test/*.test.ts test/*.test.mjs
```

Results: focused tests 14/14; strict TypeScript clean; full web suite 44/44. Parent owns browser and packaged-app revalidation after rebuilding the web assets.

Read-only review commands from workspace root:

```powershell
Get-Content switchboard/docs/HANDOFF-CODEX.md; Get-Content switchboard/docs/WEB-OVERHAUL-BRIEF.md; git status --short; git diff --stat -- switchboard/apps/web; Get-Content switchboard/apps/web/src/conversations.ts; Get-Content switchboard/apps/web/src/ApprovalCard.tsx; Get-Content switchboard/apps/web/src/screens/Chat.tsx
```

Then from the actual `switchboard` Git repository:

```powershell
git status -sb; git diff --stat -- apps/web; $n=0; Get-Content apps/web/src/screens/Chat.tsx | ForEach-Object { $n++; if ($n -le 160) { '{0,4} {1}' -f $n, $_ } }; Get-Content apps/web/src/Composer.tsx; Get-Content apps/web/src/ConversationList.tsx; Get-Content apps/web/src/ws.ts; Get-Content apps/web/src/chat-state.ts
$n=0; Get-Content apps/web/src/screens/Chat.tsx | ForEach-Object { $n++; if ($n -ge 158 -and $n -le 330) { '{0,4} {1}' -f $n, $_ } }; Get-Content apps/web/src/Transcript.tsx; Get-Content apps/web/src/transcript-state.ts; Get-Content apps/web/src/Markdown.tsx; Get-Content apps/web/src/commands.ts; Get-Content apps/web/src/ApprovalCard.tsx; rg -n -A 32 'async chat\(' packages/core/src/runtime.ts; Get-Content apps/web/src/types.ts; Get-Content apps/web/package.json
$n=0; Get-Content apps/web/src/App.tsx | ForEach-Object { $n++; '{0,4} {1}' -f $n, $_ }; Get-Content apps/web/test/conversations.test.ts; Get-Content apps/web/test/chat-state.test.ts; Get-Content apps/web/test/transcript-state.test.ts; git diff -- apps/web/src/screens/Settings.tsx apps/web/src/screens/Approvals.tsx apps/web/src/chat-state.ts
rg -n -A 35 'deleteSession|replaceMessages' packages/core/src/sessions.ts; Get-Content apps/web/test/browser-preview.mjs -First 110; Get-Content apps/web/test/transcript-render.test.mjs -First 80; git diff -- apps/web/src/App.tsx
```
