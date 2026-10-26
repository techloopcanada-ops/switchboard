# Switchboard store listing draft (Google Play first)

Drafted October 25, 2026 under the TechLoop identity. Nothing here is submitted. Every claim must stay true of the shipped build; no reviews, user counts or savings figures may be invented.

## Identity

| Field | Value |
|---|---|
| Developer / seller | TechLoop |
| Android package | `ca.techloop.switchboard` |
| iOS bundle id (later) | `ca.techloop.switchboard` |
| Expo account | `focust` (same as Kerf Pocket) |
| Support email | techloopcanada@gmail.com |
| Address | TechLoop, 2482 Yonge Street #1533, Toronto, ON M4P 2H5, Canada |
| Support URL | to deploy from `docs/SUPPORT.md` on the TechLoop Cloudflare account, e.g. `switchboard.techloopcanada.workers.dev/support` |
| Privacy URL | to deploy from `docs/PRIVACY-POLICY.md`, e.g. `switchboard.techloopcanada.workers.dev/privacy` |
| Price | Free |
| Category | Productivity (alternative: Tools) |

## Text

**Title (30):** Switchboard: Bots, Any Model

**Short description (80):** Remote for your own AI bots: chat, watch tools run, approve actions from your phone.

**Full description:**

Switchboard turns your computer into a switchboard for AI bots. Each bot has its own model (30+ providers, or Ollama on your machine), its own tools, skills, memory and monthly budget. Bots answer in the desktop app, in Telegram and Discord, and on this phone.

This app is the phone remote. It pairs with your computer by scanning a QR code, over your own Wi-Fi or Tailscale. No account, no cloud, no server in between.

- Chat with any of your bots and watch tool calls as they happen.
- Approve or deny risky actions (writing files, running commands, fetching the web, sending messages) with one tap. Unanswered requests are denied automatically.
- Switch bots and start fresh conversations.
- Get a push notification when a bot is waiting on you.

Requires the free, open-source Switchboard desktop or server software on a computer you control. Model usage is billed by the provider you choose; this app is free and contains no ads or analytics.

## Store assets needed

- App icon 512 × 512 PNG (from `apps/mobile/assets/icon.png`, re-export without alpha for Play).
- Feature graphic 1024 × 500.
- At least two phone screenshots, 1080 × 1920 recommended: Pair screen with QR, Chat with a tool call, Approvals with a pending request, Settings. Capture from the real app; do not mock.

## Data safety answers (Play)

- Data collected by TechLoop: none.
- Data sent off the device by the app: chat text and approval decisions go to the user's own computer over their network (user-controlled server, not a TechLoop service); the Expo push token goes to Expo's push service for notifications. Encryption in transit: local network traffic is HTTP on the user's LAN or Tailscale; pushes use HTTPS.
- Account creation: none. Deletion: uninstall removes all app data.
- Permissions: camera (QR scanning only), notifications.

## Content rating

Everyone. No user-generated content is hosted by TechLoop; conversations stay on the user's devices.

## Known gaps before submission

- A production-signed build from EAS (`eas build -p android --profile production`), not the debug-signed test APK.
- Firebase Cloud Messaging credentials on the EAS project so Android pushes work.
- Google Play developer enrollment under TechLoop (same open item as Kerf Pocket).
- Deployed support and privacy pages.
