# Publishing Switchboard without a traceable identity

What "completely private" can and cannot mean, and the exact steps. Verified facts are marked; the rest is practice, not law.

## What is already true

- The Switchboard code, docs and research mention no personal name or personal email. `node scripts/privacy-check.mjs` enforces this and also catches machine usernames, hostnames and home-directory paths.
- Git commits in this workspace are authored `Codex <codex@localhost>`; no personal git identity is configured.
- The apps send no telemetry: pi-ai attribution headers are disabled, Expo updates are off, there are no analytics SDKs. The Guide bot no longer prints the machine hostname.
- Mobile pushes go through Expo's push service with only the bot name and a one-line summary.

## Where identity still leaks today, and the fix

| Leak | Where | Fix |
|---|---|---|
| Windows username in paths | Codex command logs under `research/`, build scratch files | Keep `research/` out of the public repo (publish `switchboard/` as its own repository). The privacy check flags any that slip in. |
| Expo account handle in `apps/mobile/app.json` (`owner`) | needed for EAS builds and push | Create a project-only Expo account with a project email, log in, set `owner` to it, run `eas init` again. The handle is a pseudonym either way; this just separates it from your personal email. |
| Business identity used for Kerf Pocket (brand, support email, mailbox address) | `release/`, `support/`, root `README.md` | Those are Kerf files, not Switchboard. Do not reuse them for Switchboard unless you want the two linked. |

## Accounts to create under a project identity (only you can do these)

1. **Email and domain.** A project domain with WHOIS privacy (most registrars include it) and a mailbox on it. Use it for every account below.
2. **GitHub.** New organization owned by a new account. Enable "Keep my email addresses private" and commit as `<handle> <id+handle@users.noreply.github.com>`. Set this per repository: `git config user.name <handle>` and `git config user.email <noreply>`.
3. **Expo (EAS).** New account with the project email; it holds the Android keystore and push credentials. Firebase for Android push is created under a Google account; use one made with the project email.
4. **App stores.** Apple shows an individual developer's legal name as the seller on every listing. Only an organization account (legal entity plus D-U-N-S number) shows the company name instead. Google Play shows the developer name you set and a contact email, verifies legal identity privately, and can require a visible address depending on account type and payment status; check the current policy before enrolling. A company (an LLC, or an existing business with a registered-agent or virtual-office address) is the only way to keep a person's name off both stores.
5. **Affiliate programmes.** Networks need legal name and tax details to pay out; that stays between you and the network. Public links carry only an opaque code. Payouts to a company keep the person out of it.
6. **Hosting the website.** Cloudflare Pages or Workers under the project email; no personal domain.

## Operational habits

- Never run `git commit` from a shell where a personal git identity is configured globally. This machine currently has none, which is good.
- Run `node scripts/privacy-check.mjs` before every push; add your real name and other identifiers to `scripts/privacy-terms.txt` locally and keep that file out of the public repo (`.git/info/exclude`).
- Do not paste logs with `C:\Users\<name>` paths into issues; the check catches files, not chats.
- Payment and tax relationships are the one place a legal name is unavoidable. A company puts the company's name there instead of yours.
