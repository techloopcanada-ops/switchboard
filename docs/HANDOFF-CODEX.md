# Handoff to Codex: finish, verify and ship the Switchboard overhaul

From Claude, October 26, 2026. My usage ran out mid-task, so you now own the remaining work end to end: review, verify on a real Android environment, build, commit and push. Everything below is current as of the moment I wrote it; check `git status` first.

## Paste-ready prompt for the chat

> Read `switchboard/docs/HANDOFF-CODEX.md` and do the tasks in it in order. Claude is out of usage, so you own review, emulator verification of the phone keyboard fix, the arm64 APK, the Windows installer, the commit and the push. Stop and ask the owner before installing anything over their running app or pushing anything that failed verification.

## Why this work exists

The owner tried Switchboard and said: **"It's clunky. I can't see what I'm typing. Chats disappear. It won't learn skills."** Root causes, all confirmed in code and in their real database:

| Complaint | Real cause | Where it is fixed |
|---|---|---|
| Can't see what I'm typing | The phone app runs edge-to-edge (Android 15+), where `adjustResize` does nothing, and the chat screen had no keyboard handling, so the keyboard slid over the input. The owner's own phone message was cut off at exactly that point | `apps/mobile` (rewritten; **not yet verified on a device**) |
| Chats disappear | A fresh conversation opened on every web launch or reload; the sidebar only listed the selected bot's chats; opening a chat created empty rows; the phone's New button deleted the conversation; re-pairing changed the phone's chat key | core (done, tested), web (yours, done, unreviewed), phone (rewritten, unverified) |
| `/bot coder` was sent to the model | Slash commands were only handled inside Telegram and Discord | core `Switchboard.command()` (done) |
| Won't learn skills | The daemon never reloaded its skill list after a save (ten skills sat on disk, invisible), the Assistant bot had no `save_skill`, and nothing prompted learning | core (done) |

## State of the repository right now

Repo: `switchboard/` (its own git repo, branch `main`, author `TechLoop <techloopcanada@gmail.com>`, remote `origin` = https://github.com/techloopcanada-ops/switchboard, `gh` is logged in as `techloopcanada-ops`).

| Item | State |
|---|---|
| `3b0a294` core overhaul | Committed **and pushed**. 28 core tests pass (`units`, `runtime`, `overhaul`) |
| `5ba6654` phone rewrite | Committed **locally only, not pushed**. Typechecks. **Never run** |
| This handoff, `scripts/preview-faux.mjs`, PairScreen keyboard fix | Uncommitted (mine) |
| Your web overhaul (`apps/web/**`) | Uncommitted. I verified: `npm run build -w apps/web` passes, `npm run typecheck -w apps/web` passes, `npm run test -w apps/web` = 39 passing. Evidence screenshots in `apps/web/test/evidence/` |
| Installed desktop app on the owner's PC | **Old build** (9:11 PM Oct 25). Installer in `apps/desktop/release` is also old until you rebuild |
| Owner's phone app | Old build (has the cleartext fix and Firebase config, but not the rewrite) |

## Tasks, in order

### 1. Orient and re-run the baseline (10 minutes)

From `switchboard/` (never use `npx` or `.bin` shims: the folder name contains `&` and breaks them):

```powershell
git status -sb; git log --oneline -6
node node_modules/typescript/bin/tsc -p packages/core/tsconfig.json
node --test packages/core/test/units.test.ts packages/core/test/runtime.test.ts packages/core/test/overhaul.test.ts   # run inside packages/core, expect 28 pass
npm run build -w apps/web; npm run typecheck -w apps/web; npm run test -w apps/web                                    # expect 39 pass
cd apps/mobile; node node_modules/typescript/bin/tsc --noEmit                                                         # expect clean
node ../../scripts/privacy-check.mjs                                                                                   # from apps/mobile: expect clean
```

### 2. Review your own web work against the brief with fresh eyes

Walk `docs/WEB-OVERHAUL-BRIEF.md` acceptance criteria one by one against the running UI (use the preview daemon below with `PREVIEW_HOST=127.0.0.1 PREVIEW_PORT=7791`). The criteria most likely to hide bugs, check these explicitly:

- Type text, reload the page: conversation and draft restore. Close and reopen the **Electron** window (not only the browser): same.
- Switch bot in the header: the previous conversation stays in the sidebar list; selecting a row from another bot switches the bot.
- `/bot coder` switches bot and is not sent to the model; `/etc/hosts is a file` **is** sent to the model.
- An approval card appears inline; Allow lets the run finish; Always allow stops the next prompt for that category; the confirm dialog appears for `shell` and `self-modify`.
- A conversation opened by id that has never been used (empty) does not appear in the sidebar and does not create a row.
- Composer text is visible in light and dark, at 360px and 1280px, with a long multi-line draft.

Fix anything that fails. Do not touch `packages/core/src` unless a real defect requires it; if so, add a test in `packages/core/test/overhaul.test.ts` and say so in your report.

### 3. Verify the phone fix in the Android emulator (the owner's top complaint)

This is the step I could not finish. Everything needed is on this machine.

**Environment facts**
- Emulator AVD: `sl35` (Android 35, `google_apis`, x86_64, 1080×2400, soft keyboard, hardware accel on). Do not use `orbitalxr36`.
- Tools: `%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe` and `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`. The emulator reaches the host at `10.0.2.2`. The emulator image has **no `curl`**; use `adb` only.
- The test daemon is `scripts/preview-faux.mjs` (real core, scripted fake model, throwaway home in `%TEMP%`, token `ui-test-token-ui-test-token-1234`, auto-exits after 90 minutes). Start it with `node scripts/preview-faux.mjs` (defaults to `0.0.0.0:7795`). A message containing `write` makes the bot call `write_file` (needs approval); `long` produces a scrolling reply; anything else echoes. **Never point tests at the owner's real daemon on port 7787 or their real `~/.switchboard`.**
- An APK built for the emulator must be x86_64. Build it separately from the phone APK:

```powershell
cd switchboard\apps\mobile
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-apk.ps1 -BuildDir C:\sw -Install -Abis x86_64
# result: C:\sw\android\app\build\outputs\apk\release\app-release.apk (about 31 MB, about 5 minutes)
```

**Run**

```powershell
$sdk = "$env:LOCALAPPDATA\Android\Sdk"; $adb = "$sdk\platform-tools\adb.exe"
Start-Process "$sdk\emulator\emulator.exe" -ArgumentList '-avd','sl35','-no-snapshot-save','-no-boot-anim','-no-audio' -WindowStyle Minimized
& $adb wait-for-device; & $adb shell getprop sys.boot_completed       # wait until 1
& $adb install -r C:\sw\android\app\build\outputs\apk\release\app-release.apk
& $adb shell pm grant ca.techloop.switchboard android.permission.POST_NOTIFICATIONS
& $adb shell monkey -p ca.techloop.switchboard -c android.intent.category.LAUNCHER 1
cmd /c "`"$adb`" exec-out screencap -p > shot.png"                       # then read shot.png to see the screen
```

Driving the UI: `adb shell input tap X Y` (coordinates are in the 1080×2400 frame), `adb shell input text 'abc%sdef'` (`%s` is a space), `adb shell input keyevent 4` (back), `adb shell input keyevent 66` (enter). To find elements reliably instead of guessing coordinates: `adb shell uiautomator dump /sdcard/ui.xml; adb pull /sdcard/ui.xml` and read `bounds=` for the node whose `content-desc` or `text` you need (the chat input has `content-desc="Message"`, buttons are `Send`, `Stop`, `New conversation`, `Conversations`, `More`). Pairing: in the Pair screen type `http://10.0.2.2:7795` into the URL field and `ui-test-token-ui-test-token-1234` into the token field, then Connect (the first-run field positions on this screen: URL about y=1436, token about y=1570, Connect about y=1705; they shift once the keyboard opens, so re-dump).

**What must be true (pass criteria), with screenshots saved to `apps/mobile/test-evidence/`:**
1. With the on-screen keyboard open in the chat, the message box, its text and the Send button are fully visible above the keyboard, and the most recent message is visible above the box. Type a long multi-line message (use `%s` and several `input text` calls) and confirm the box grows and stays visible.
2. The bottom tab bar hides while the keyboard is open and returns when it closes.
3. Pair screen: when the URL and token fields are focused, they stay visible above the keyboard.
4. Send `hello`: a streamed reply appears. Send `write a file`: an approval card appears **inline** in the chat; Allow completes the run with a markdown reply showing a code block.
5. Type `/`: the command hints appear; send `/bot coder`: a note appears, the bot switches, nothing was sent to the model.
6. Open the **Chats** sheet: conversations from more than one bot are listed grouped by day; long-press (or the ⋯ button) offers Rename and Delete; rename and delete work.
7. `adb shell am force-stop ca.techloop.switchboard`, relaunch: the app reconnects, reopens the **same conversation**, and an unsent draft typed before the stop is restored.
8. The "New conversation" (+) button starts an empty chat **without** removing the old one from the list.

**If criterion 1 fails.** Likely causes, try in this order: (a) double padding (a gap above the keyboard) because Expo's manifest also sets `adjustResize`: remove the `KeyboardAvoidingView` on Android in `ChatScreen.tsx` and let the OS resize, or the reverse; (b) the `FlatList` needs `automaticallyAdjustKeyboardInsets`; (c) last resort, add `react-native-keyboard-controller` through `npx expo install` equivalent (`node node_modules/expo/bin/cli install react-native-keyboard-controller`) and use its `KeyboardAvoidingView`. Re-verify after each change. Keep the visible-composer styling (`color #FFFFFF` on `#1B2340`, 16px, caret color) regardless.

Also check the same flow once on the **android-36** image if time permits (create another AVD from `system-images/android-36/google_apis/x86_64`; do not reuse `orbitalxr36`, it is an XR profile).

### 4. Build the phone APK (arm64, the file the owner installs)

```powershell
cd switchboard\apps\mobile
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-apk.ps1 -BuildDir C:\sw -Install      # default ABI is arm64-v8a
Copy-Item C:\sw\android\app\build\outputs\apk\release\app-release.apk ..\..\release\switchboard-0.1.0-android-test.apk -Force
```

Then verify with `aapt dump badging` (package `ca.techloop.switchboard`, `native-code: 'arm64-v8a'`), `apksigner verify --print-certs` (Android Debug cert is expected), and `aapt dump xmltree ... AndroidManifest.xml` showing `usesCleartextTraffic`. Record size and SHA256 in `release/ARTIFACTS.txt`. The file must stay **under 30 MiB** so it can be sent to the owner through the remote file channel (the arm64-only build is about 28.5 MiB; an APK with both ABIs is not sendable). Increment `android.versionCode` in `apps/mobile/app.json` (currently 1) so it installs over the old one cleanly.

### 5. Rebuild the Windows installer

```powershell
cd switchboard
npm run build
npm run dist -w apps/desktop
# result: apps/desktop/release/Switchboard-Setup-0.1.0-x64.exe, about 122 MB, unsigned
node apps/desktop/test/packaged-smoke.mjs      # must report passed and gracefulExit
```

Record checksum in `release/ARTIFACTS.txt`. **Do not install it over the owner's running app yourself.** The running app is `C:\Program Files\Switchboard\Switchboard.exe` serving the owner's real data from `%USERPROFILE%\.switchboard`; installing means closing it, and any connected phone drops briefly. Ask first. The installer does not touch `%USERPROFILE%\.switchboard`.

### 6. Documentation touch-ups

- `docs/TUTORIALS.md` tutorial 3 ("Teach a bot a skill"): rewrite around the real flow now: do a multi-step task, a Suggested skill card appears, read it, Save skill; or type `/learn`. Point to `docs/SKILLS-AND-LEARNING.md`. Mention `/help`.
- `docs/SETUP.md`: add one line that slash commands work in every chat surface.
- Update `docs/MOBILE.md` with the emulator procedure you used.

### 7. Commit and push

```powershell
cd switchboard
node scripts/privacy-check.mjs                # must print clean
git add -A; git status --short                # no *.apk, no google-services.json, no .switchboard-secrets paths
```

**Commit messages: never use double quotes.** Windows PowerShell 5.1 splits native arguments at embedded double quotes and the commit silently fails. Use a single-quoted here-string with no double quotes inside, exactly like earlier commits. Suggested split: (1) web overhaul, (2) docs and scripts, (3) artifact checksums (phone rewrite is already commit `5ba6654`). Then `git push origin main`. Push **only** after tasks 2 and 3 pass; if emulator verification fails and you cannot fix it, commit but do not push, and say so.

### 8. Tell the owner

Write results to `research/codex-status.md` (what passed, exact commands, what you could not verify) and tell the owner in chat. Send the arm64 APK with the file-send tool if you have one; otherwise give its path. Remind them to uninstall nothing: it installs over the current one.

## Gotchas learned the hard way

- **The `&` in the workspace path** breaks `npx`, `.bin` shims, `gradlew.bat` and the native Android build. Call tools via `node node_modules/<pkg>/bin/<bin>`, and build Android only from `C:\sw` (the script handles it). The native build also needs `CMAKE_OBJECT_PATH_MAX=240`, already applied by `apps/mobile/plugins/with-cmake-object-path-max.js`.
- **Never copy the Android project with a robocopy `/XD android`** pattern: it removes every folder named `android` inside `node_modules` and breaks Expo's config plugins. The script uses full paths for this reason.
- **Do not run the native build from a shell with a short timeout.** An interrupted Gradle run leaves ninja's glob re-check broken; use a new `-BuildDir` rather than deleting long-path trees.
- **PowerShell 5.1:** no `&&`, no `Start-Process -Environment`, `Set-Content -Encoding UTF8` writes a BOM (Groovy and some tools reject it), scripts need `-ExecutionPolicy Bypass`, and `eas` must be called as `eas.cmd`.
- **Android 9+ blocks plain HTTP** unless the manifest opts in; this is done by `plugins/with-cleartext-traffic.js` (the old `usesCleartextTraffic` key in `app.json` was silently ignored).
- **Windows adapters:** the Pair list ranks Wi-Fi first, then Tailscale, then virtual adapters (WSL, Hyper-V). Phones cannot reach virtual ones.
- **Ports:** the owner's real daemon uses 7787. Use 7791 and 7795 for tests.

## Rules that still apply

- Identity is **TechLoop** everywhere (app id `ca.techloop.switchboard`, author TechLoop, support `techloopcanada@gmail.com`). Nothing may contain the owner's personal name or email; `scripts/privacy-check.mjs` enforces it. Do not put the owner's pairing token or any API key in chat, commits or logs (the token has already been exposed once in a chat; offering a rotation is welcome, see below).
- Do not send messages, make purchases, enroll in stores, or change the owner's real `~/.switchboard`, accounts or Telegram/Discord settings.
- Firebase project `switchboard-951dd`, Expo project `@focust/switchboard`, GitHub account `techloopcanada-ops` are set up; the FCM service-account key lives only at `%USERPROFILE%\.switchboard-secrets\switchboard-fcm.json` and never goes in the repo.
- Treat the owner's goal as: **an app that works and looks professional**. Prefer fixing a real defect over adding features.

## Nice to have, only after everything above

- **Token rotation:** `node packages/core/dist/cli.js rotate-token` plus a Settings button that issues a new token and shows the new pairing QR (the current token was pasted into a chat). Needs a daemon restart note and a test.
- The owner's `~/.switchboard/skills` holds ten generic skills the old Coder generated in one batch (git, docker, CI and so on). They are filler, not learned from real work. Do not delete them; suggest in your report that the owner review them in the Skills screen.
- Telegram and Discord have never been run against the real services.
- A real push notification on the owner's phone has not been confirmed end to end.
- iOS is not started.
