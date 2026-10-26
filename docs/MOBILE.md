# Switchboard mobile (Android first)

The phone app is a remote control for the daemon on your computer: chat with any bot, see tool activity, and allow or deny approvals. It never talks to a server of ours. It connects straight to your computer over your Wi-Fi or Tailscale, and approval pushes go through Expo's notification service with only the bot name and a one-line summary.

## Pairing

1. On the computer: Settings → General → Server host `0.0.0.0`, save, restart. The API stays protected by the token.
2. Open the Pair tab. It shows a QR code per network address.
3. On the phone: Scan QR code, or paste the text, or type the URL and token.
4. The phone checks `/api/status`, saves the connection in the device's secure store, and registers for pushes.

If pairing fails: both devices must reach each other (same Wi-Fi, or Tailscale on both), Windows Firewall must allow Node on private networks, and the daemon must be running. Pairing over the public internet is deliberately unsupported. The Pair tab lists Wi-Fi addresses first; virtual adapters (WSL, Hyper-V, Docker) are listed last and never work from a phone.

The connection is plain HTTP by IP address, so the app opts in to cleartext traffic through `plugins/with-cleartext-traffic.js` (Android blocks it by default and reports "CLEARTEXT communication … not permitted"). The bearer token protects the API, and Tailscale encrypts the link when you pair over it.

## Push notifications

The EAS project (`@focust/switchboard`) and Firebase project (`switchboard-951dd`) are configured. See [PUSH-SETUP.md](PUSH-SETUP.md) for credentials and setup; do not initialize a second project for this checkout. The phone's Settings screen shows its registration state and the reason when registration fails.

While the app is open, approvals arrive live over the WebSocket regardless of push. Real push delivery to a physical phone has not been verified for this release.

## Building the APK

The local release build uses the Android debug key (installable for testing, not for Play). It needs Node, JDK 17 with `JAVA_HOME` set, and the Android SDK. Two Windows constraints shape the procedure, both handled by `apps/mobile/scripts/build-apk.ps1`:

- The native build cannot run from a path containing `&` or spaces, so the script copies the app to a short path (`C:\sw` by default).
- Windows' 260-character path limit breaks React Native codegen object paths; `plugins/with-cmake-object-path-max.js` caps `CMAKE_OBJECT_PATH_MAX` at 240 so CMake hashes them. The script also patches an already generated `android/app/build.gradle`.

From the repository root:

```powershell
Set-Location apps/mobile
# First build only: C:\sw must not already exist.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-apk.ps1 -BuildDir C:\sw -Fresh
# Subsequent builds: refresh source, install dependencies, prebuild, then build.
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-apk.ps1 -BuildDir C:\sw -Install
```

The result is `C:\sw\android\app\build\outputs\apk\release\app-release.apk`, built for **arm64-v8a only** by default. `-Install` installs build dependencies and refreshes the copied project; it does **not** install an app on a device. Omitting both `-Fresh` and `-Install` builds the sources already in `C:\sw`, so use `-Install` after checkout changes. If an interrupted native build leaves broken intermediates, choose a new short `-BuildDir` with `-Fresh` instead of deleting long-path trees. Let Gradle finish.

The October 26 test release is version **0.1.0 / versionCode 2**, package `ca.techloop.switchboard`, with an arm64 APK below the **30 MiB** delivery limit. Its debug certificate, arm64 ABI, cleartext manifest setting, and signature were checked. The deliverable is `release/switchboard-0.1.0-android-test.apk`; see [ARTIFACTS.txt](../release/ARTIFACTS.txt) for the current byte count, SHA256, and certificate details. Install it over the existing test app without uninstalling to preserve its local state. It has not yet been tested on the owner's physical phone.

Build an **x86_64-only** APK separately for the emulator using `-Abis x86_64`. Do not combine ABIs into the phone APK: that exceeds the delivery size limit. Each build replaces the APK in `C:\sw`; copy the arm64 result to the release path after rebuilding for the phone:

```powershell
# From apps/mobile, after emulator verification:
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-apk.ps1 -BuildDir C:\sw -Install
Copy-Item -LiteralPath 'C:\sw\android\app\build\outputs\apk\release\app-release.apk' -Destination '..\..\release\switchboard-0.1.0-android-test.apk' -Force
```

Cloud builds use the existing EAS project: `eas.cmd build -p android --profile preview` on Windows.

## Verified Android emulator procedure

The release source passed the recorded acceptance checks on October 26, 2026 using AVD **sl35**, Android 35 Google APIs **x86_64**, 1080×2400, with the on-screen keyboard (`hw.keyboard=no`). The emulator was started without a visible window on port 5554. Screenshots and UI bounds came from adb. Do not use the unrelated `orbitalxr36` XR profile.

1. From the repository root, build and start the disposable fake-model daemon in its own terminal:

   ```powershell
   npm run build
   $env:PREVIEW_HOST = '0.0.0.0'
   $env:PREVIEW_PORT = '7795'
   node scripts/preview-faux.mjs
   ```

   Wait for `PREVIEW READY`. This fixture uses a throwaway home and test-only token `ui-test-token-ui-test-token-1234`. Use port **7795**, never the owner's daemon on **7787** or their data directory. `hello` produces a scripted reply, `write a file` requests a real write approval in the disposable workspace, and `long` produces 14 paragraphs. Stop the fixture with Ctrl+C when finished.

2. In another terminal at the repository root, build the emulator APK. The verified run used the existing `C:\sw` copy; use `-Fresh` instead of `-Install` if starting in a new build directory.

   ```powershell
   Set-Location apps/mobile
   node node_modules/typescript/bin/tsc --noEmit
   node --test test/chat-state.test.ts test/approval-state.test.ts
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-apk.ps1 -BuildDir C:\sw -Install -Abis x86_64
   ```

3. Start the prepared AVD and target its serial explicitly:

   ```powershell
   $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
   $adb = Join-Path $sdk 'platform-tools\adb.exe'
   Start-Process -FilePath "$sdk\emulator\emulator.exe" -ArgumentList '-avd','sl35','-port','5554','-no-snapshot-save','-no-boot-anim','-no-audio','-no-window' -WindowStyle Hidden
   & $adb -s emulator-5554 wait-for-device
   & $adb -s emulator-5554 shell getprop sys.boot_completed
   ```

   Continue once `sys.boot_completed` is `1`. Install only on this emulator:

   ```powershell
   & $adb -s emulator-5554 install -r C:\sw\android\app\build\outputs\apk\release\app-release.apk
   & $adb -s emulator-5554 shell pm grant ca.techloop.switchboard android.permission.POST_NOTIFICATIONS
   & $adb -s emulator-5554 shell monkey -p ca.techloop.switchboard -c android.intent.category.LAUNCHER 1
   ```

4. Pair using `http://10.0.2.2:7795` and the fixture token. This address reaches the host from the emulator. Inspect a fresh UI dump before each tap because keyboard visibility changes field positions:

   ```powershell
   & $adb -s emulator-5554 shell uiautomator dump /sdcard/sb-ui.xml
   & $adb -s emulator-5554 shell cat /sdcard/sb-ui.xml
   # Tap the center of the desired node's bounds, then type. %s means a space.
   & $adb -s emulator-5554 shell input text 'hello'
   & $adb -s emulator-5554 shell input keyevent 66
   & $adb -s emulator-5554 shell input text 'Second%sline'
   ```

   `input keyevent 66` adds a line in the multiline composer; tap **Send** to submit. `input keyevent 4` dismisses the keyboard. During approval countdowns, `uiautomator` may fail to reach idle and leave old XML behind. Require a successful fresh dump or use a fresh screenshot before tapping an approval.

5. Capture PNG bytes through Node rather than PowerShell 5 text redirection. Save this helper as `capture-emulator.mjs`, then run `node capture-emulator.mjs shot.png` from that directory:

   ```javascript
   import { execFile } from 'node:child_process';
   import { promisify } from 'node:util';
   import { writeFile } from 'node:fs/promises';
   import path from 'node:path';

   const adb = path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe');
   const { stdout } = await promisify(execFile)(adb,
     ['-s', 'emulator-5554', 'exec-out', 'screencap', '-p'],
     { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
   await writeFile(process.argv[2] ?? 'shot.png', stdout);
   ```

6. Exercise the checks below. For lifecycle recovery, type an unsent multiline draft, then force-stop and relaunch without clearing app data:

   ```powershell
   & $adb -s emulator-5554 shell am force-stop ca.techloop.switchboard
   & $adb -s emulator-5554 shell monkey -p ca.techloop.switchboard -c android.intent.category.LAUNCHER 1
   ```

   When all checks are complete, stop the test app and emulator:

   ```powershell
   & $adb -s emulator-5554 shell am force-stop ca.techloop.switchboard
   & $adb -s emulator-5554 emu kill
   ```

### Passing results and limits

| Checked behavior | Result |
| --- | --- |
| Pair URL/token fields with keyboard open | Both focused fields remain visible |
| Eight-line draft, visible final line, Send button | Composer grows and stays above the keyboard |
| Keyboard open/closed | Bottom tabs hide and return |
| `hello`, `write a file`, Allow | Reply streams; approval appears inline; accepted write completes with Markdown/code |
| `/` and `/bot coder` | Hints appear; bot switches with no extra model call |
| Chats across bots | Day grouping, search, rename, delete, and New retaining history pass |
| Force-stop/relaunch | Same conversation and multiline unsent draft restore |
| Long reply, reading older text, Latest | Last paragraph stays above the composer; scrolling up pauses following; Latest restores the bottom |

The old APK reproduced the hidden-input defect. Moving keyboard avoidance above the headers at the app root corrected the layout offset: the final input/Send bottom was about 1491–1492px while the keyboard began at 1517px. A separate long-reply test exposed estimated `scrollToEnd` behavior; measured-content scrolling and gesture-aware following corrected it.

See [the evidence README](../apps/mobile/test-evidence/README.md), [assertion results and tested x86_64 APK identity](../apps/mobile/test-evidence/checks.json), and [exact adb argument arrays](../apps/mobile/test-evidence/adb-commands.json). The separately built arm64 APK uses the same source, but **Android 36, a physical phone, real provider authentication, and real push delivery were not exercised**.

Drafts are stored on this phone, not synchronized between devices. An inherited limitation remains: local current-chat/draft keys are shared across paired servers, so pairing to a different daemon with the same bot ids can restore the previous daemon's local drafts.

## What is not in v1

iOS build (needs a Mac or EAS iOS credentials), voice, file attachments, editing bots from the phone, background polling without push.
