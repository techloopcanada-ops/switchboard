# Switchboard release checklist

October 25, 2026. Identity decision: TechLoop (same as Kerf Pocket). Check items off only with evidence recorded next to them.

## Done

- [x] Core daemon with 17 passing tests; web UI builds; desktop Windows installer built with passing packaged smoke test (`apps/desktop/release`).
- [x] Android test APK built locally, debug-signed, package `ca.techloop.switchboard` pending rebuild (first test build used `app.switchboard.mobile`). Checksums in `release/ARTIFACTS.txt`.
- [x] Privacy checker clean; identity fields set to TechLoop; privacy policy, support page and store listing drafted in `docs/` and `release/`.

## Owner actions (need your accounts)

- [x] **Expo project.** `@focust/switchboard`, id `1093be0f-bd9e-4c52-9fc5-145f322f4c20`, recorded in `app.json` (Oct 25, 2026).
- [x] **Push credentials.** Firebase project `switchboard-951dd` under the TechLoop Google account with Android app `ca.techloop.switchboard`; `google-services.json` in `apps/mobile` (ignored by git); FCM V1 service-account key and an EAS-generated upload keystore are on the Expo project (verified on the credentials page, Oct 25, 2026). Key kept privately outside the repo.
- [ ] **Production Android build.** `eas build -p android --profile production` (AAB) and `--profile preview` (APK) with the EAS-managed keystore.
- [ ] **Support and privacy pages.** Deploy `docs/SUPPORT.md` and `docs/PRIVACY-POLICY.md` on the TechLoop Cloudflare account, same pattern as Kerf's `support/worker.mjs`. Record the URLs in `release/STORE_LISTING.md`.
- [ ] **Google Play enrollment** under TechLoop, then create the app, fill the listing from `STORE_LISTING.md`, upload screenshots from the real app, answer data safety as drafted, submit for review.
- [ ] **Source publication.** Decide the GitHub organization (TechLoop) and account. Commit author for this repo: `TechLoop <techloopcanada@gmail.com>`. Run `node scripts/privacy-check.mjs` before the first push. Publish only `switchboard/`; never the parent workspace or `research/`.
- [ ] **Affiliate programmes.** Apply under TechLoop (DigitalOcean, Vultr, Hetzner, RunPod, Novita, AI/ML API, LLM Gateway) and enter the codes under Settings → General → Referral codes.
- [ ] **Name check.** Search trademarks for "Switchboard" in software before any paid marketing; rename if needed (it is a codename).

## Before calling it released

- [ ] Install the production APK on a real phone, pair with a computer on Wi-Fi, approve one write from the phone, receive one push.
- [ ] Run through `docs/SETUP.md` on a clean Windows machine.
- [ ] Confirm the listing text matches the shipped feature set.

## Measurement after release (from the research memo)

Fewer than 200 GitHub stars or 100 installs in 60 days, fewer than 5 affiliate conversions in 90 days, or pairing success under 90% in testing means stop or revise. Revenue is unknown until it happens.
