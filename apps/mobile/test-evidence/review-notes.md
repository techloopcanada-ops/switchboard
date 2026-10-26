# Mobile review and fixes — 2026-10-26

Scope: ChatScreen, storage, HistorySheet, and a small pure state helper/test. App approval handling is owned by the parallel reviewer. Native config/build scripts are owned by the parent. No core edits, builds, installs, commits, or pushes were performed in this subtask.

## Changes

- Drafts write immediately through a serialized queue, keyed by both bot and conversation. Reads wait behind earlier writes; failed writes cannot stop later writes. A write failure is surfaced on the phone.
- A sent draft stays until server acknowledgement. Exact revision/identity guards prevent repeated acknowledgements from clearing a new draft, including identical text. Failed messages can be restored without silently replacing newer text.
- Open/load responses check both conversation identity and request generation. Reconnect releases the stuck busy state, refreshes persisted history, and preserves an interrupted-message notice. Active event updates invalidate stale history snapshots.
- Never-sent chats with text are reachable under **Drafts on this phone** in Chats. Local drafts can be deleted; persisted chats retain rename/delete behavior.
- Clear/Delete preserve the visible conversation on HTTP failure and show an error. Delete captures the intended session id before confirmation.
- Slash hints are scrollable and capped at 120px. The transcript follows its bottom on viewport layout changes only while already at the bottom. Existing KeyboardAvoidingView behavior is preserved for emulator verification.

## Verification and limitations

Mobile TypeScript passes. Two pure tests pass: acknowledgement identity/revision guards, and serialization/recovery after a failed storage write. `git diff --check` passes (only existing line-ending conversion warnings). Privacy check is clean. Native layout, force-stop restore, and reconnect behavior require the parent's emulator checks; no device behavior is claimed verified here.

Targeted ESLint cannot run because this app has no `eslint.config.js`, `.mjs`, or `.cjs`; installed ESLint is 9.39.5. No configuration or dependency was added for this task. Node tests print the existing module-type warning because the mobile package does not declare `type: module`; both tests pass.

## Exact commands

From `apps/mobile`:

```powershell
Get-Content src/storage.ts; Get-Content src/screens/ChatScreen.tsx; Get-Content src/components/HistorySheet.tsx; Get-Content App.tsx; Get-Content tsconfig.json; Get-Content package.json; rg --files test test-evidence
Get-Content src/connection.ts -TotalCount 96; rg -n -A 24 -B 7 'hello|chat_result|type: .start.|isRunning|running|activeRuns' ../../packages/core/src/server.ts ../../packages/core/src/runtime.ts ../../packages/core/src/sessions.ts
node node_modules/typescript/bin/tsc --noEmit; node --test test/chat-state.test.ts
node node_modules/eslint/bin/eslint.js src/screens/ChatScreen.tsx src/storage.ts src/chat-state.ts src/components/HistorySheet.tsx --max-warnings 0
Get-Content src/screens/ChatScreen.tsx | Select-Object -Skip 175 -First 195; Get-Content src/storage.ts; Get-Content src/components/HistorySheet.tsx -TotalCount 85
node node_modules/typescript/bin/tsc --noEmit; node --test test/chat-state.test.ts; node ../../scripts/privacy-check.mjs
```

The initial `rg --files test test-evidence` reported nonexistent directories; both directories were created by this task. All preceding file reads in that command succeeded.

From the `switchboard` repository root:

```powershell
git diff --stat -- apps/mobile/src/screens/ChatScreen.tsx apps/mobile/src/storage.ts apps/mobile/src/components/HistorySheet.tsx; git diff --check; node apps/mobile/node_modules/typescript/bin/tsc --noEmit -p apps/mobile/tsconfig.json; node --test apps/mobile/test/chat-state.test.ts
```

Edits used `apply_patch`. Paths in this note are relative so the evidence remains portable and contains no personal identity.

## Follow-up race fixes

Bot navigation now marks itself pending before fetching history, blocks Send synchronously, and releases its pending state after the selected chat loads or navigation fails. Clear invalidates older history snapshots before the request and after success. HistorySheet accepts only its latest load and invalidates pending snapshots on close/unmount. The parent's newer inner plain View in ChatScreen is preserved; keyboard avoidance is now owned by the parent at the app root.

Inherited release limitation: current-chat and local-draft storage are shared across paired servers on this phone. Re-pairing to a different daemon with matching bot ids can restore the previous server's local drafts. No server namespace migration was added in this release.

Additional exact commands, from `apps/mobile`:

```powershell
Get-Content src/chat-state.ts; Get-Content src/storage.ts; Get-Content src/screens/ChatScreen.tsx; Get-Content src/components/HistorySheet.tsx
rg -n -A 25 -B 8 'openBot|clearMessages|const load|useEffect|KeyboardAvoidingView|onDeleted|setCurrent|loadVersion' src/screens/ChatScreen.tsx src/components/HistorySheet.tsx; Get-Content src/screens/ChatScreen.tsx -TotalCount 5; Get-Content test-evidence/review-notes.md -Tail 18
node node_modules/typescript/bin/tsc --noEmit; node --test test/chat-state.test.ts; git diff --check -- src/screens/ChatScreen.tsx src/components/HistorySheet.tsx
```

Typecheck, both state tests, and the targeted whitespace check pass. These component guards reuse existing refs; no extra pure helper or artificial mirror test was introduced.

## Remaining inherited edge cases

Local phone chat/draft keys are not partitioned by paired server. Re-pairing to a different daemon can reopen a previous local draft if bot IDs overlap. The normal same-daemon persistence path passes emulator checks.

Core broadcasts chat `start` with run/bot/chat identity but no originating request ID. Two clients sending concurrently to the same chat can ambiguously associate an early start with their own pending send. This was not exercised by the single-phone fixture; no core protocol changes were made. Matched run completion now preserves newer queued requests after reconnect.
