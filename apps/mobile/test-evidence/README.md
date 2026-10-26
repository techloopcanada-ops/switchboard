# Android release verification — October 26, 2026

Verified on **sl35**, Android 35 Google APIs x86_64, 1080×2400, using the on-screen keyboard. All commands target `emulator-5554`. The app connects to `http://10.0.2.2:7795`, a disposable `scripts/preview-faux.mjs` daemon with a fake model. No owner data or real provider was used.

`checks.json` records 23 passing assertions and the final tested x86_64 APK hash. `adb-commands.json` records navigation/assertion adb argument arrays in order. Each screenshot separately ran `adb -s emulator-5554 exec-out screencap -p` through Node `execFile` with `encoding: 'buffer'` and saved that buffer with `fs.writeFile`, preserving binary PNG bytes. Screenshots capture both the reproduced defects and the passing result.

| Requirement | Evidence |
| --- | --- |
| Input, typed text and Send above the keyboard; multiline growth | `chat-keyboard-multiline.png`, `final-keyboard-and-latest.png` |
| Latest long reply stays above composer | `long-reply-keyboard.png` |
| Reading earlier messages pauses following; Latest returns to bottom | `reading-history-pauses-follow.png`, `latest-restored-bottom.png` |
| Latest remains outside an eight-line draft while reading older messages | `latest-above-eight-line-draft.png`, `latest-tall-draft-bottom.png` |
| Tabs hide with keyboard, return when closed | `chat-keyboard-multiline.png`, `chat-keyboard-closed.png` |
| Both pairing fields remain visible when focused | `pair-url-keyboard.png`, `pair-token-keyboard.png` |
| Hello reply, inline approval, Allow and markdown/code | `hello-reply.png`, `inline-write-approval-keyboard-closed.png`, `write-allowed-markdown.png` |
| Slash hints and local bot switch | `slash-command-hints.png`, `slash-bot-switched.png` (model count stayed at 1) |
| All bots, day grouping, search, rename, delete | `history-all-bots.png`, `history-search.png`, `history-renamed.png`, `history-deleted.png` |
| Same chat and multiline draft after force-stop | `force-stop-draft-restored.png` |
| New retains history; deleting current opens empty chat | `new-keeps-history.png`, `deleted-current-empty.png` |

The old APK reproduced the keyboard defect: input/Send bottom was 1732/1733 while the keyboard started at 1517. The root keyboard layout fixes this to 1491/1492, with a visible gap. A second test found FlatList's estimated `scrollToEnd` left a tall markdown row near its beginning. Using measured content height fixes it; gesture handling keeps reading position intact. The `baseline-*` and `long-reply-inspect.png` images document the failures before repair.

During an approval countdown, Android's UI dumper could not reach idle and left an old XML file in place. A first retry tap consequently hit Stop; the app correctly restored the failed draft. The harness was changed to require a successful fresh dump, and Allow was tapped using a fresh screenshot. The retried write completed. UI dump parsing also needed to handle both XML quote styles. These were harness issues, not unexplained passing assertions.

Native commands from `apps/mobile`:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot'
node node_modules/typescript/bin/tsc --noEmit
node --test test/chat-state.test.ts test/approval-state.test.ts
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-apk.ps1 -BuildDir C:\sw -Install -Abis x86_64
```

After review edits, source-only incremental builds preserved the already generated native project:

```powershell
$taskMobile = (Get-Location).Path
robocopy "$taskMobile\src" 'C:\sw\src' /E /NFL /NDL /NJH /NJS
if ($LASTEXITCODE -ge 8) { exit 1 }
Copy-Item -LiteralPath 'App.tsx' -Destination 'C:\sw\App.tsx' -Force
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-apk.ps1 -BuildDir C:\sw -Abis x86_64
# Repeated after each of the two scrolling fixes:
Copy-Item -LiteralPath 'src/screens/ChatScreen.tsx' -Destination 'C:\sw\src\screens\ChatScreen.tsx' -Force
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-apk.ps1 -BuildDir C:\sw -Abis x86_64
```

The source was then refreshed with `-Install` for the separate default arm64 build. Final layout review moved Latest from absolute positioning into a row above the composer, preventing overlap with a tall draft. After copying ChatScreen again, `-Abis x86_64` rebuilt for the three additional passing emulator checks; `-Abis arm64-v8a` rebuilt the final phone artifact from those same copied sources. The second fixture was another fresh throwaway home. Android 36, a physical phone, real provider authentication and real push delivery were not exercised. Mobile ESLint has no configuration; TypeScript and all 12 pure tests pass. See `review-notes.md` for the source review and its remaining protocol/storage limitations.
