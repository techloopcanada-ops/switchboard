# Monetization plan (hypotheses, with evidence)

Switchboard is free and MIT-licensed. Revenue comes from things users would buy anyway, surfaced honestly inside the product. Nothing here is validated; the research memo (`research/switchboard-research.md`) sets kill criteria.

## 1. Referral and affiliate links (launch)

Where they appear: the Get started screen (choose a provider), Settings → Providers (get a key), and the "Run 24/7 on a server" card. Every link shows the word "affiliate" and the disclosure text. Recommendations never change because of commission: OpenRouter is listed first for breadth even though it has no programme.

| Programme | Type | Reward (as seen Oct 25, 2026) | Status |
|---|---|---|---|
| DigitalOcean | hosting | 10% monthly commission for 12 months on referred spend (official affiliate page; a second official page lists other plans) | apply at digitalocean.com/affiliates |
| Vultr | hosting | $30 to $100 CPA per activated referral (third-party listings) | apply, verify official terms |
| Hetzner | hosting | account credits only | apply via hetzner.com/legal/referrals |
| RunPod | GPU | 10% cash for six months via PartnerStack (2026 roundup) | apply, verify in dashboard |
| Novita AI | inference | two-sided $10 credits, capped, 90-day expiry | invite code from novita.ai/referral |
| AI/ML API | inference | up to 30% recurring (their page) | apply at aimlapi.com/affiliate |
| LLM Gateway | inference | 1% of referred spend as credits | llmgateway.io/referrals |
| OpenRouter, Anthropic, OpenAI, Google | inference | no programme | plain links |

How it is wired: `packages/core/src/referrals.ts` holds the catalogue with `template` URLs; the owner enters codes under Settings → General → Referral codes; `GET /api/referrals` returns resolved links with an `affiliate` flag. No code, no affiliate link.

Expected scale: small. Hosting CPA programmes pay only when a user actually buys a server, which is a minority of installs. Treat the first 90 days as a measurement, not income.

## 2. Pro license (later, if installs exist)

One-time purchase for the desktop and mobile pair: multi-device sync of bots and sessions, team approvals (two people must allow), and priority support. Not built. Decide after 500 installs.

## 3. GitHub Sponsors (launch)

Zero cost to add. Expect near-zero revenue; it mostly signals that the project is maintained.

## 4. Templates marketplace (idea only)

Paid bot and workflow bundles (for example "release manager", "support triage") with revenue share. Needs a community first.

## What we will not do

No ads, no telemetry resale, no silent affiliate defaults, no bundled API keys with hidden margin.
