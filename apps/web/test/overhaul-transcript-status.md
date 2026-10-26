# Web overhaul — transcript and preview fixture

Date: October 25, 2026. Work is confined to `apps/web`. No core edits, dependency changes, commits, or real provider/account calls.

## Implemented

- `src/Markdown.tsx`: marked + DOMPurify rendering into an owned DOM fragment, excluding scripts/forms/embedded media/style. Fenced code blocks show their language and Copy. Clipboard fallback supports HTTP LAN origins. Assistant reply Copy uses the original Markdown text.
- `src/Transcript.tsx`: user bubbles, assistant Markdown, compact expandable tool rows with arguments and output, failure styling, Retry restoring the relevant user message, live tool rows, and cost/tokens only under the latest completed reply. Completed-run aggregate usage takes precedence over the last model turn's usage.
- `src/transcript-state.ts`: stored tool results grouped under their calling assistant by `toolCallId`; unmatched historical results remain visible; legacy missing IDs fall back to an unresolved call of the same tool. Includes `shouldStickToBottom` with an 80px default threshold and compact tool argument summaries.
- `test/transcript-state.test.ts` and `test/transcript-render.test.mjs`: six passing tests for tool-result ownership, out-of-order/error results, orphan results, nonmutation, Retry prompts, scroll boundaries, aggregate cost placement, and live tool rendering.
- `test/browser-preview.mjs`: repeatable real-daemon fixture using `fauxProvider`, fixed loopback port 7791, disposable data/workspace, no paid model. Ordinary text returns Markdown/code; “write a file” requests `write_file`; `/bot` goes through the real command endpoint; `/learn` returns an approval-backed skill proposal; “fixture error” tests Retry. `--self-test` checks the actual endpoints and safely removes its isolated directory.

Root owns the scroller, persisted/live transcript deduplication, Chat network state and shared types. Root was told that the active run should receive persisted history trimmed after its last user message, then be replaced with full stored history on completion. Root also received all component CSS class names.

## Verification

- `node --test test/transcript-state.test.ts`: **4 passed**.
- `node --test test/transcript-state.test.ts test/transcript-render.test.mjs`: **6 passed**.
- `node test/browser-preview.mjs --self-test`: final run **passed** local slash routing without model/session writes, Allow, Always allow, the next write without approval, persisted tool results, skill suggestion, and skill save event. The fixture shut down and released port7791.
- Full web TypeScript check was attempted during concurrent integration. Its only reported error was the old Chat prop signature versus the new App props. No errors were reported in these owned files. Root will run the final integrated check.
- The fixture self-test first caught an incorrectly escaped code fence in a template literal; replaced it with a normal quoted string. The next run caught an assertion treating an omitted policy as explicit `ask`; corrected it to honor the core default. Both failures are fixed and the final self-test passed.
- No independent browser session or screenshots were taken by this agent; parent owns final browser acceptance checks. The Node rendering tests validate structure and cost placement, not rendered DOMPurify HTML (which is verified in the browser).

## Exact shell commands run

Commands below ran from the workspace root unless a different directory is noted.

```powershell
Get-Content switchboard/docs/WEB-OVERHAUL-BRIEF.md; Get-Content switchboard/apps/web/src/screens/Chat.tsx; Get-Content switchboard/apps/web/src/chat-state.ts; Get-Content switchboard/apps/web/src/types.ts; Get-Content switchboard/apps/web/test/browser-preview.mjs; Get-Content switchboard/packages/core/test/runtime.test.ts; Get-Content switchboard/packages/core/src/runtime.ts | Select-Object -Skip 1 -First 70; Get-Content switchboard/packages/core/src/sessions.ts -TotalCount 110
```

```powershell
rg -n 'fauxProvider|FauxProvider|responses|setResponses|FauxResponse' switchboard/node_modules/@earendil-works/pi-ai/dist/testing/faux-provider.* switchboard/node_modules/@earendil-works/pi-ai -g '*faux*'; Get-Content switchboard/packages/core/src/runtime.ts | Select-Object -Skip 210 -First 145; Get-Content switchboard/packages/core/src/learning.ts; Get-Content switchboard/apps/web/tsconfig.json; Get-Content switchboard/apps/web/test/settings.test.mjs
```

That initial dependency search referenced a nonexistent `dist/testing` path; corrected by inspecting the package file inventory:

```powershell
rg --files --no-ignore switchboard/node_modules/@earendil-works/pi-ai | rg 'faux|testing'; Get-Content switchboard/packages/core/src/runtime.ts | Select-Object -Skip 100 -First 115; Get-Content switchboard/packages/core/src/runtime.ts | Select-Object -Skip 365 -First 90; rg -n -A 105 'async learnFrom' switchboard/packages/core/src/runtime.ts; Get-Content switchboard/apps/web/package.json
```

```powershell
Get-Content switchboard/node_modules/@earendil-works/pi-ai/dist/providers/faux.d.ts; Get-Content switchboard/node_modules/@earendil-works/pi-ai/dist/providers/faux.js | Select-Object -First 240; Get-Content switchboard/packages/core/src/server.ts | Select-Object -Skip 70 -First 105
```

```powershell
rg -n -A 25 -B 4 'interface TranscriptContext|type TranscriptContext|setResponses\(|responses.shift|FauxResponse' switchboard/node_modules/@earendil-works/pi-ai/dist/types.d.ts switchboard/node_modules/@earendil-works/pi-ai/dist/providers/faux.js; Get-Content switchboard/packages/core/src/config.ts -TotalCount 75; rg -n 'streamFn' switchboard/packages/core/src/models.ts
```

From `switchboard/apps/web`:

```powershell
node --test test/transcript-state.test.ts
node test/browser-preview.mjs --self-test
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node test/browser-preview.mjs --self-test
node test/browser-preview.mjs --self-test
node --test test/transcript-state.test.ts test/transcript-render.test.mjs
```

One initial `apply_patch` attempt combined Delete/Add for the same fixture path and was rejected without changes; retried as an Update successfully. All file edits used `apply_patch`.

## Documentation lookup

Used Context7 `resolve_library_id` for DOMPurify, then `/cure53/dompurify` query: “RETURN_DOM_FRAGMENT and FORBID_TAGS html sanitization; modifying sanitized DOM safely for text-only toolbar controls”. The result confirmed direct insertion of a sanitized DocumentFragment and the tag/attribute allowlist controls. Dynamic toolbar text uses `textContent`; controls are created by the component, not accepted from model HTML.

## Follow-up Chat/Composer review

Read-only review reported four issues to the parent: a second `acknowledge` on chat_result could erase a newly typed draft identical to the sent one; Tab/Shift+Tab could be trapped by an exact command suggestion; arrow-selected commands could remain outside the picker's scroll viewport; and the mobile conversation drawer lacked focus transfer/trapping. Also flagged that an unsent new-chat draft was stored but unreachable after changing bot/New chat because server listings intentionally contain only persisted conversations.

Parent explicitly assigned the two Composer fixes here. Updated only `src/Composer.tsx` for those fixes: accepting a completion dismisses that value without the subsequent value effect reopening it; subsequent typing clears dismissal; Shift+Tab is not intercepted; the selected option scrolls into view. Full web TypeScript check passed after this edit. Parent owns browser assertions for Tab/Shift+Tab focus and picker scrolling. No artificial pure helper was added for component-local focus state.

Additional exact shell commands, from the workspace root:

```powershell
Get-Content switchboard/apps/web/src/screens/Chat.tsx; Get-Content switchboard/apps/web/src/Composer.tsx; Get-Content switchboard/apps/web/src/conversation-state.ts; Get-Content switchboard/apps/web/src/command-state.ts; Get-Content switchboard/apps/web/src/App.tsx; Get-Content switchboard/apps/web/src/chat-state.ts
```

The two `*-state.ts` filenames did not exist; their actual filenames were `conversations.ts` and `commands.ts`, read below. Other reads succeeded.

```powershell
$reviewLine = 0; Get-Content switchboard/apps/web/src/Composer.tsx | ForEach-Object { $reviewLine++; '{0,4}: {1}' -f $reviewLine, $_ }; Get-Content switchboard/apps/web/src/conversations.ts; Get-Content switchboard/apps/web/src/commands.ts; Get-Content switchboard/apps/web/src/ConversationList.tsx; Get-Content switchboard/apps/web/src/screens/Chat.tsx | Select-Object -Skip 270 -First 65
```

```powershell
rg -n 'conversation-backdrop|conversations-open|\.conversations\b|command-picker|aria|inert|focus' switchboard/apps/web/src/styles.css switchboard/apps/web/src/screens/Chat.tsx switchboard/apps/web/src/ConversationList.tsx switchboard/apps/web/src/Composer.tsx; Get-Content switchboard/apps/web/test/conversations.test.ts; Get-Content switchboard/apps/web/test/commands.test.ts; Get-Content switchboard/apps/web/src/ws.ts
```

From `switchboard/apps/web` (exit 0):

```powershell
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

## Composer long-draft scrolling follow-up

Parent browser verification found a 14-line draft returning to scrollTop 0 despite the caret being at its end. Updated `Composer.tsx` only: preserve scrollTop around height measurement, scroll to the bottom when the caret is collapsed at the value end, filter the parent's ResizeObserver callback to width changes, and add a window resize listener for viewport height caps. This prevents the textarea's own height adjustment from triggering another reset. Parent owns the real-browser check with Control+End and sequential typing on line 14.

Exact additional commands from the workspace root:

```powershell
Get-Content -LiteralPath 'switchboard/apps/web/src/Composer.tsx'
rg -n -A 14 -B 6 'composer-input|composer textarea|chat-message' switchboard/apps/web/src/styles.css; Get-Content -LiteralPath 'switchboard/apps/web/test/overhaul-transcript-status.md' -Tail 65
```

From `switchboard/apps/web`:

```powershell
node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

This check was blocked by concurrent edits outside this assignment: `src/ConversationList.tsx(19,815)` TS1005 (`}` expected) and `(19,816)` TS1381 (unexpected token). Reported to parent immediately; did not edit that component. Composer's browser scroll behavior remains for the parent's next build/check.
