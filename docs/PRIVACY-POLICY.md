# Privacy policy — Switchboard

Last updated: October 25, 2026. Switchboard is provided by TechLoop. This policy covers the Switchboard desktop and server software, the Switchboard Android app, and the support website.

## Summary

Switchboard runs on your own computer or server. TechLoop operates no servers that receive your bots, conversations, files, keys or usage. The software has no account system, no advertising and no analytics. What leaves your devices goes only to services you choose and configure yourself, and this policy says what and when.

## Data that stays on your devices

- Configuration, including provider API keys and chat-platform tokens, in the Switchboard home folder (`~/.switchboard`).
- Bots, skills, memory files, workflows and the conversation database (SQLite) in that folder.
- On the phone: the pairing address and token in the device's secure storage.

Deleting the Switchboard home folder and uninstalling the apps removes all of it. Your operating system's backup service may keep copies.

## Data sent to services you configure

- **Model providers.** Conversation text, tool results, file contents you ask a bot to read, and the system prompts for your bots are sent to the model provider you select for each bot (for example OpenRouter, Anthropic, OpenAI, Google, or a local Ollama server). Each provider's own privacy policy applies. Switchboard disables its runtime's attribution headers; requests identify the provider SDK only.
- **Telegram and Discord.** If you connect them, messages flow through those platforms under their policies. Switchboard only polls their APIs outbound; it exposes no web server to them.
- **Phone pushes.** If you pair the Android app, approval alerts go through Expo's push notification service. Each push contains the bot's name and a one-line summary of the action. The push token is stored in your Switchboard configuration.
- **Web pages a bot fetches.** The `web_fetch` tool downloads pages you or a bot request, using a plain Switchboard user agent.

## Affiliate links

Setup screens show links to model providers and hosting companies. Some carry an affiliate code that may earn TechLoop a commission or credits at no extra cost to you. They are labelled "affiliate" wherever they appear and do not change which option is recommended.

## The support website

The support and privacy pages are hosted on Cloudflare. Cloudflare records standard request logs (IP address, user agent, time) under its policies. The pages set no cookies and load no third-party scripts.

## Support email

If you email support, TechLoop keeps the correspondence to answer you. Do not send API keys or tokens by email.

## Children

Switchboard is not directed at children under 13.

## Changes

Changes to this policy are published at the same address with a new date.

## Contact

TechLoop, 2482 Yonge Street #1533, Toronto, ON M4P 2H5, Canada. Email: techloopcanada@gmail.com.
