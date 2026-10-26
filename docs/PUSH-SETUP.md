# Android push notifications: Firebase credentials for the EAS project

Expo delivers Android pushes through Firebase Cloud Messaging (FCM V1). Two files come out of the Firebase console: a client config (`google-services.json`) that goes into the app, and a service-account key that goes to Expo's servers so they may send on the project's behalf. The Expo project is `@focust/switchboard`. Do everything with the TechLoop Google account.

## 1. Firebase project and Android app (console, about five minutes)

1. Open https://console.firebase.google.com, signed in as the TechLoop Google account, and click **Add project**. Name it `switchboard`. Google Analytics is not needed; turn it off.
2. In the new project, click the Android icon (**Add app**). Android package name: `ca.techloop.switchboard` (must match exactly). App nickname: Switchboard. Leave the SHA-1 empty for now.
3. Click **Register app**, then **Download google-services.json**. Skip the remaining SDK steps; Expo handles them.
4. Move the file to `switchboard/apps/mobile/google-services.json`. It is ignored by git on purpose; `app.config.js` picks it up automatically.

## 2. Service-account key (console, two minutes)

1. In the Firebase project, open the gear icon → **Project settings** → **Service accounts**.
2. Click **Generate new private key**, then **Generate key**. A JSON file downloads.
3. Move it somewhere private outside the repository, for example `%USERPROFILE%\.switchboard-secrets\switchboard-fcm.json`. Treat it like a password; it is also ignored by git if it ever lands in the project.

## 3. Upload the key to the EAS project (one interactive command)

From `switchboard/apps/mobile`, logged in to Expo as `focust`:

```powershell
eas.cmd credentials -p android
```

Choose, in order: `production` → `Google Service Account` → `Manage your Google Service Account Key for Push Notifications (FCM V1)` → `Set up a Google Service Account Key for Push Notifications (FCM V1)` → `Upload a new service account key`, then give the path to the JSON from step 2. Repeat for the `preview` profile if you build test APKs with EAS.

Dashboard alternative: https://expo.dev/accounts/focust/projects/switchboard/credentials → Android → the application identifier → **FCM V1 service account key** → **Add a service account key**.

## 4. Rebuild and test

The client config is compiled into the app, so rebuild after step 1:

```powershell
cd switchboard\apps\mobile
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-apk.ps1 -BuildDir C:\sw -Install
```

Install the new APK, pair with the computer, and open **Settings** in the app. It should read "Registered ExponentPushToken[…]". If it says "no project", the build predates `eas init`; if it says "denied", allow notifications for Switchboard in Android settings.

Then trigger a real approval with the app in the background: ask the Coder bot in the web UI to write a file. A push titled "Coder needs approval" should arrive within seconds; tapping it opens the Approvals tab. The daemon's log prints any Expo push errors.

## If pushes still fail

- **DeviceNotRegistered** or **InvalidCredentials** in the daemon log: the uploaded key belongs to a different Firebase project than the `google-services.json` in the build, or the key lacks the **Firebase Cloud Messaging API Admin** role (Google Cloud Console → IAM → the service account → add that role).
- **403 PERMISSION_DENIED** when the app requests a token: the API key inside `google-services.json` is restricted. In Google Cloud Console → APIs & Services → Credentials, allow the FCM Registration API and Firebase Installations API for that key, or remove the restriction.
- Pushes work only in builds from this project (local APK or EAS). Expo Go cannot receive them.
