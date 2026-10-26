# Switchboard support

Switchboard runs your AI bots on your own computer, connects them to Telegram, Discord and your phone, and asks you before anything risky happens. Start with the questions below, or email TechLoop.

## Common questions

**It says a provider has no API key.** Open the web UI, go to Settings → Providers, add a key for the provider your bot uses (OpenRouter gives one key for most models), then pick a default model. Ollama and LM Studio need no key: add them as an OpenAI-compatible provider with their local address.

**A bot stopped and is waiting.** It asked for approval. Open Approvals in the web UI, on the phone, or answer the Allow / Deny buttons in Telegram or Discord. Unanswered approvals are denied when they expire (default five minutes).

**Telegram says I am not allowed.** Send `/start` to your bot; it shows your Telegram user id. Add that id under Settings → Channels → Telegram → allowed users, save, and try again.

**The phone cannot pair.** Both devices must share a network (or run Tailscale), the computer must have Server host set to `0.0.0.0` under Settings → General, and the Switchboard daemon must be running. Windows Firewall must allow Node on private networks.

**Pushes do not arrive on Android.** Approvals still show live while the app is open. Background pushes need the app build to be registered with Expo and Firebase; the Settings screen in the app shows the current registration state and reason.

**Where is my data?** In the Switchboard home folder on your computer (`~/.switchboard`): configuration, bots, skills, memory, workflows and the conversation database. Nothing is uploaded to TechLoop. See the privacy policy.

**How do I remove everything?** Stop Switchboard, delete `~/.switchboard`, uninstall the desktop and phone apps, and revoke any API keys or bot tokens you created for it.

**A tool call did something I did not expect.** Tools run exactly what the bot requested; the Approvals history shows every allowed call with its arguments. Tighten a bot's policy under Bots → policy (set a category to `never`), or give it a narrower working directory.

## Contact

Email techloopcanada@gmail.com with your Switchboard version, operating system, what you tried and the exact error text. Do not include API keys or tokens.

TechLoop, 2482 Yonge Street #1533, Toronto, ON M4P 2H5, Canada.
