# Set up Switchboard

Switchboard runs bots on your computer. A model generates replies and requests tools. You decide which tool categories can run automatically, need approval, or are blocked.

This guide uses the [Switchboard source checkout](https://github.com/techloopcanada-ops/switchboard). `@switchboard/core` is not published to npm yet.

## 1. Install and build

1. Install [Node.js](https://nodejs.org/en/download) 22.19 or newer and Git. Open a new terminal. Check both:

   ```sh
   node --version
   git --version
   ```

2. Clone the repository. In PowerShell:

   ```powershell
   git clone https://github.com/techloopcanada-ops/switchboard.git switchboard
   Set-Location switchboard
   ```

   In bash:

   ```bash
   git clone https://github.com/techloopcanada-ops/switchboard.git switchboard
   cd switchboard
   ```

   If you already have this workspace, open a terminal in its `switchboard` directory instead. All remaining commands assume that directory unless stated otherwise.

3. Install dependencies and build:

   ```sh
   npm install
   npm run build
   ```

   On Windows, a directory containing `&` can break npm executable shims. The workspace scripts use `node` with explicit script paths. Do not substitute `npx vite` or `npx tsc`. To build the web UI directly, from `apps/web` use:

   ```sh
   node ../../node_modules/vite/bin/vite.js build
   ```

4. Run the interactive setup:

   ```sh
   node packages/core/dist/cli.js setup
   ```

   Choose `openrouter` and supply a key and model ID, or choose `ollama` with `http://localhost:11434/v1` and an installed model ID. Skip Telegram for now. Choose a dedicated working directory for bot files. The current setup prompt echoes typed keys; do not screen-share it.

5. Start the daemon and leave its terminal open:

   ```sh
   node packages/core/dist/cli.js start
   ```

   Open [http://127.0.0.1:7787](http://127.0.0.1:7787). The browser on the same machine receives the API token automatically. Press Ctrl+C in the terminal to stop the daemon.

6. In **Settings → Providers**, check the configured provider, refresh its models, and choose a default model. Check **Bots → Guide** uses that provider and model. In **Chat**, select **Guide**, start a new chat, and send: `Hello. What is configured, and what should I try first?`

   When the default changes, bots using the previous default follow the new model. Bots assigned to a different model keep that choice. Setting the first default updates all built-in bots. The **Get started** checkbox can also apply the selected model to built-in bots that had a different model. Running the CLI `setup` again updates all built-in bots too; use **Bots** for individual choices.

Slash commands work in every chat surface: desktop/web, the phone app, Telegram, and Discord. Start with `/help`; `/learn` reviews the current conversation for a reusable skill.

### Use the desktop app

1. Stop the standalone CLI daemon with Ctrl+C. From `switchboard`, after the build above, run:

   ```sh
   npm run start -w apps/desktop
   ```

   The desktop process starts its own daemon using the same configuration and port. An `EADDRINUSE` error means another process already owns that port. Stop the other Switchboard process before retrying; do not run two daemons against one data directory.
2. Closing the window hides it in the system tray and keeps the daemon running. Click the tray icon or choose **Open Switchboard** to reopen it. Choose **Quit Switchboard** in the tray to stop the daemon and exit.
3. Choose **Pause channels** in the tray to disconnect Telegram and Discord without stopping the web UI, phone access, or workflow scheduler. Choose **Resume channels** to reconnect using the current settings. Workflow deliveries to paused channels will fail; pausing channels does not cancel active bot runs or prevent other tools from running. Pause state lasts until you resume or quit the app.

To create the Windows x64 installer, run `npm run dist -w apps/desktop` after building. The installer appears in `apps/desktop/release`. This development build is unsigned, so Windows may show an unknown-publisher or SmartScreen warning. Verify its source before installing; public distribution needs a separate signing/release process.

## 2. Choose a provider

### OpenRouter

1. Create a key in [OpenRouter's key dashboard](https://openrouter.ai/keys). Check your account's credit balance and model price. OpenRouter authenticates API calls with that key. [Official quickstart](https://openrouter.ai/docs/quickstart).
2. In **Settings → Providers**, select the built-in `openrouter` provider, enter the key, and save.
3. Refresh models. Select a model available to your account and save it as the default. For tool-based tutorials, choose a model that supports tool calls.
4. Open **Bots** and set Guide and Coder to the chosen model. Send a short test message before starting a long task.

OpenRouter is listed for convenience; the current referral catalog does not provide a general OpenRouter affiliate link.

### Ollama on this computer

1. Install and start [Ollama](https://ollama.com/download). Download a model that fits your machine. For example, the [Qwen3 catalog](https://ollama.com/library/qwen3) includes tool-capable models:

   ```sh
   ollama pull qwen3:8b
   ollama list
   ```

   This is a multi-gigabyte download. If the model does not fit in memory, choose a smaller installed model.
2. In **Settings → Providers**, add an OpenAI-compatible provider with ID `ollama`, name `Ollama`, and base URL `http://localhost:11434/v1`. Leave its API key empty for a local unauthenticated Ollama server. This endpoint is documented in [Ollama's compatibility guide](https://docs.ollama.com/api/openai-compatibility).
3. Save, then refresh models. Choose the exact model ID shown by `ollama list`, such as `qwen3:8b`. If discovery fails, enter that ID in the custom-model field.
4. Save the default, then select the same provider and model for the bot you want to use. Leave its thinking setting **off** initially.

`localhost` here means the machine running the daemon. A phone connects to Switchboard; it does not need its own Ollama server. LM Studio uses the same provider type with `http://localhost:1234/v1` after you start its local server and load a model.

## 3. Telegram in five steps

1. Open the verified [@BotFather](https://t.me/BotFather) in Telegram. Send `/newbot`, choose a name and username, and copy the token. Keep it private. [Telegram's bot introduction](https://core.telegram.org/bots).
2. In **Settings → Channels**, paste the Telegram token. Leave allowed user IDs empty for this first save. Choose a default bot, save, then use **Restart channels**.
3. Open a private chat with your new Telegram bot and send `/start`. Switchboard replies with your numeric user ID even before you are allowed to chat.
4. Add that number to **Allowed user IDs** in Switchboard and save. Add only people who should be able to use your bots and approve tool calls. An empty list allows nobody.
5. Send `/start` again, then `/bots`, `/bot guide`, and a greeting. Use `/bot coder` for coding and `/new` for a fresh conversation. Approval messages have **Allow** and **Deny** buttons.

Telegram uses outbound long polling. No public URL or inbound port is needed. Start the private chat before expecting notifications. Approvals from other surfaces are sent to allowed Telegram users' private chats too.

## 4. Discord in seven steps

1. Open the [Discord Developer Portal](https://discord.com/developers/applications). Create an application. [Official setup guide](https://docs.discord.com/developers/quick-start/getting-started).
2. Open **Bot** and generate/reset its token. Copy it privately; this is the bot token, not the application's public key.
3. Enable **Message Content Intent** under **Privileged Gateway Intents**, then save. Switchboard requests this intent. [Gateway documentation](https://docs.discord.com/developers/events/gateway).
4. In the portal's installation settings or OAuth2 URL generator, create a **Guild Install** link with the `bot` scope. Grant **View Channels**, **Send Messages**, and **Read Message History**. Open the link and invite the bot to a server you manage. It does not need Administrator.
5. In Discord, enable **User Settings → Advanced → Developer Mode**. Right-click your own profile and choose **Copy User ID**. [Discord's ID guide](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID).
6. In **Settings → Channels**, enter the Discord token, your numeric user ID, and a default bot. Save and use **Restart channels**. Keep IDs as their full digit strings.
7. DM the bot, or mention it in a permitted server channel: `@YourBot /bots`, then `@YourBot /bot guide`, then `@YourBot Hello`. These are ordinary text messages; Switchboard does not register Discord slash commands. In DMs, omit the mention.

Discord connects through an outbound WebSocket. It needs no inbound port. It ignores unmentioned server messages and users outside the allowlist. Discord approval buttons appear in the channel where the request originated; web-originated approvals do not get sent to Discord automatically.

## 5. Pair a phone

1. Install the Switchboard Android companion build supplied by the maintainer. Mobile builds are maintained separately in `apps/mobile`; there is no public store download promised by this guide. You can also use a phone browser with the URL and token below.
2. Put the phone and daemon on the same trusted network, or connect both to your [Tailscale network](https://tailscale.com/docs/how-to/quickstart).
3. In **Settings → General**, set the host to `0.0.0.0` and save. Restart the daemon or quit and reopen the desktop app. Changing host or port requires a process restart. `0.0.0.0` listens on every IPv4 interface; it is not the address to type on your phone.
4. Open **Pair** on the computer. Choose the LAN or Tailscale address the phone can reach. Scan its QR code in the companion, or paste the displayed pairing text if that build accepts it. The link has this shape: `switchboard://pair?url=...&token=...`.
5. Allow notifications if the companion asks. Open **Approvals** and test a harmless file write from Coder before relying on remote approvals. If scanning is unavailable, open the displayed HTTP address in the phone browser and enter the API token when prompted.

Keep TCP port 7787 private. Permit it only from your trusted LAN or Tailscale interface in the host firewall. Do not forward it through your router. If pairing fails, check the host binding, daemon restart, firewall, and chosen network address. Loopback `127.0.0.1` on a phone points to the phone itself.

The **Devices** list tracks registered push destinations. Removing a device stops its push notifications; it does not revoke its copy of the shared API token. To revoke access, stop the daemon, replace `token` in your private `config.json` with a new random secret, restart, and pair trusted devices again. Paired push notifications use Expo's service and contain the bot name and approval summary. Without push registration, keep the companion or browser open to receive live approvals.

## 6. Run 24/7 on a Linux VPS

Use a dedicated non-root account on a Linux server with systemd, Git, and Node 22.19+. A cloud model provider avoids needing a GPU on that server. Review the **Run 24/7** hosting options in the UI before choosing a host; prices and referral terms can change.

> Links marked "affiliate" may earn the Switchboard maintainers a commission or credits at no extra cost to you. They never change which option we recommend.

That disclosure is the same text returned by `GET /api/referrals`. Configured referral links in the UI carry the word **affiliate**. This guide adds no referral codes or guaranteed rewards.

1. SSH into the non-root account. Clone and build from its home directory:

   ```bash
   cd ~
   read -r -p 'Repository clone URL from the project owner: ' switchboard_repo
   git clone "$switchboard_repo" switchboard-checkout
   cd switchboard-checkout/switchboard
   npm install
   npm run build
   node packages/core/dist/cli.js setup
   node packages/core/dist/cli.js start
   ```

2. Leave the server host at `127.0.0.1` for browser access through SSH. In a terminal on your own computer, replace `YOUR_USER` and `YOUR_SERVER` with the SSH account and hostname:

   ```sh
   ssh -N -L 7787:127.0.0.1:7787 YOUR_USER@YOUR_SERVER
   ```

   Open [http://127.0.0.1:7787](http://127.0.0.1:7787) locally. Stop a local Switchboard daemon first if it already owns that port. Configure providers and channels, then test a message. Telegram and Discord can work while the API stays on loopback.

3. Back on the server, stop the foreground daemon with Ctrl+C. From `~/switchboard-checkout/switchboard`, create a user service:

   ```bash
   switchboard_node="$(command -v node)"
   mkdir -p ~/.config/systemd/user
   cat > ~/.config/systemd/user/switchboard.service <<EOF
   [Unit]
   Description=Switchboard bot daemon

   [Service]
   Type=simple
   WorkingDirectory=$PWD
   ExecStart=$switchboard_node $PWD/packages/core/dist/cli.js start
   Restart=on-failure
   RestartSec=5

   [Install]
   WantedBy=default.target
   EOF
   systemctl --user daemon-reload
   systemctl --user enable --now switchboard
   sudo loginctl enable-linger "$(id -un)"
   systemctl --user status switchboard
   ```

   These paths assume the clone location above has no spaces. The unit records the absolute Node executable path. If a Node version manager moves that executable, update the unit. Lingering keeps the user service running after logout and starts its user manager at boot. [systemd service reference](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html), [loginctl reference](https://www.freedesktop.org/software/systemd/man/latest/loginctl.html).

4. Read logs or stop the service:

   ```bash
   journalctl --user -u switchboard -n 100 --no-pager
   systemctl --user stop switchboard
   systemctl --user start switchboard
   ```

   For phone access, follow the Tailscale pairing steps and firewall restrictions above. Binding to `0.0.0.0` on a VPS also listens on its public interface. Never open port 7787 to the public internet.

## Security and data

- **API token:** Treat the pairing QR and token as administrator credentials. Anyone holding the token can read chats, change configuration, approve tools, and create bots. Local browser bootstrap trusts loopback clients. Use a trusted OS account and browser. The web UI keeps its token in browser local storage.
- **Network:** The built-in server uses HTTP. Its token authenticates requests; it does not encrypt traffic. Use a trusted local network, Tailscale, or SSH tunnelling. Keep public access blocked.
- **Approvals:** Defaults allow `read` automatically. `write`, `shell`, `network`, `messaging`, and `self-modify` ask. `never` blocks that category. Requests expire to denial. Inspect arguments, paths, and commands before allowing. An approved call can have lasting effects; Abort is not undo.
- **Working directory:** File tools check that the requested path stays inside the configured directory. This is a path restriction, not a security sandbox. Symlinks can point elsewhere. Use a disposable checkout without links to sensitive files.
- **Shell:** An approved shell command runs as the daemon's OS user, inherits its environment, and can access files and networks outside the working directory. There is no Docker sandbox in v1. Keep shell on `ask` or `never`, and do not run Switchboard as root/Administrator.
- **Data:** By default, configuration, keys, transcripts, usage, skills, and memory live under `~/.switchboard` (`C:\Users\YOUR_USER\.switchboard` on Windows). `SWITCHBOARD_HOME` changes the location. Secrets are masked in API responses but stored in the local configuration file. Restrict OS access and backups. Do not commit that directory. Stop Switchboard before copying its complete data directory for a consistent backup.
- **Provider privacy and cost:** Prompts and selected tool output go to the selected model provider. Monthly budgets use reported/catalog prices and are checked before a run, so a run can overshoot. OpenAI-compatible providers currently record zero cost; their budgets are not a billing limit. Set provider-side spending limits too.

## If something fails

Run `node packages/core/dist/cli.js doctor` from `switchboard`. It reports configuration and credentials, but a configured flag alone does not prove a model call will succeed. Read the daemon terminal for channel and provider errors.

If the browser says the UI is missing, rebuild `apps/web` and restart. If chat reports an unavailable model or missing key, check that bot's own provider/model. If a channel is listed but does not reply, check its allowlist, credentials, and daemon logs. If the port is in use, stop the other Switchboard process; do not share one data directory between daemons.

Continue with [the tutorials](TUTORIALS.md).
