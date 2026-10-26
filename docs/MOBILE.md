# Switchboard mobile (Android first)

The phone app is a remote control for the daemon on your computer: chat with any bot, see tool activity, and allow or deny approvals. It never talks to a server of ours. It connects straight to your computer over your Wi-Fi or Tailscale, and approval pushes go through Expo's notification service with only the bot name and a one-line summary.

## Pairing

1. On the computer: Settings → General → Server host `0.0.0.0`, save, restart. The API stays protected by the token.
2. Open the Pair tab. It shows a QR code per network address.
3. On the phone: Scan QR code, or paste the text, or type the URL and token.
4. The phone checks `/api/status`, saves the connection in the device's secure store, and registers for pushes.

If pairing fails: both devices must reach each other (same Wi-Fi, or Tailscale on both), Windows Firewall must allow Node on private networks, and the daemon must be running. Pairing over the public internet is deliberately unsupported.

## Push notifications

Expo issues push tokens only for builds that belong to an EAS project. The project exists (`@focust/switchboard`); the remaining Firebase steps are in `docs/PUSH-SETUP.md`. Summary:

1. `cd switchboard/apps/mobile` then `eas init` (creates the project under the Expo account you are logged in to, ideally a project-only account with a project email, and writes `extra.eas.projectId` into `app.json`; set `owner` in `app.json` to that account's handle).
2. Android pushes need Firebase Cloud Messaging credentials on the EAS project: create a Firebase project, download the service-account JSON, run `eas credentials` → Android → Push notifications → upload. Without this, Expo returns tokens but Android delivery fails.
3. Rebuild the APK. The Settings screen shows the registration state and the reason when it is not registered.

While the app is open, approvals arrive live over the WebSocket regardless of push.

## Building the APK

Local release build signed with the Android debug key (installable, not for Play). Two Windows constraints shape the procedure, both handled by `scripts/build-apk.ps1`:

- The native build cannot run from a path containing `&` or spaces, so the script copies the app to a short path (`C:\sw` by default).
- Windows' 260-character path limit breaks React Native codegen object paths; `plugins/with-cmake-object-path-max.js` caps `CMAKE_OBJECT_PATH_MAX` at 240 so CMake hashes them. The script also patches an already generated `android/app/build.gradle`.

```powershell
cd switchboard\apps\mobile
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-apk.ps1 -Fresh          # first time: copy, npm ci, prebuild, build
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-apk.ps1 -BuildDir C:\sw  # later: rebuild in place
# apk at C:\sw\android\app\build\outputs\apk\release\app-release.apk (arm64-v8a; add -Abis arm64-v8a,x86_64 for emulators)
```

Do not run the native build from a sandboxed or time-limited shell: an interrupted build leaves ninja's glob re-check in a state that deletes `CMakeFiles`, and deleting such trees fails on long paths. Use a new `-BuildDir` instead.

Cloud build with EAS (needs `eas init` first): `eas build -p android --profile preview`.

## What is not in v1

iOS build (needs a Mac or EAS iOS credentials), voice, file attachments, editing bots from the phone, background polling without push.
