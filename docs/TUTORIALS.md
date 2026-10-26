# Try Switchboard

Complete [SETUP.md](SETUP.md) first. These examples use a tool-capable model. Keep the daemon running and inspect each approval before accepting it. A prompt is a request to a model; check the actual tool call and result, not just the model's claim.

## 1. Your first coding task with Coder

Goal: write and run a tiny JavaScript file, approving the write from your phone.

1. Create an empty practice directory. In PowerShell:

   ```powershell
   New-Item -ItemType Directory -Path "$HOME/switchboard-practice" -Force
   ```

   In bash:

   ```bash
   mkdir -p ~/switchboard-practice
   ```

2. Open **Bots → Coder**. Set its working directory to the absolute path you created. Select a configured, tool-capable model. Leave `read` on **auto**, and `write` and `shell` on **ask**. Enable `read_file`, `list_dir`, `write_file`, and `shell`, or keep **all tools**. Save.
3. Pair the companion as described in SETUP, or open the daemon's LAN/Tailscale address in the phone browser and enter the token. Open **Approvals** on the phone.
4. In desktop/web **Chat**, select Coder and start a new chat. Send:

   ```text
   List this directory first. If hello-switchboard.mjs already exists, stop.
   Create hello-switchboard.mjs containing exactly:
   console.log('Hello, Switchboard!');
   Use write_file for the write. Then run node hello-switchboard.mjs with shell.
   Explain the result. Do not install anything or edit other files.
   ```

5. On the phone, open the write approval. Check `write_file`, the filename, and the full content. Tap **Allow** only if they match. The desktop transcript resumes. A separate shell approval should ask to run `node hello-switchboard.mjs`; inspect and allow that too.
6. Check the tool result contains `Hello, Switchboard!` and a successful exit code. Open the created file yourself. If the model only describes the action without calling tools, ask it to execute the requested tool calls.
7. Try a second harmless write and choose **Deny**. Confirm no file was written. An expired approval is also denied. **Abort** stops a current run; it cannot revert an already approved write.

No approval appearing usually means the bot's policy is **auto**, the model never called the tool, or the phone is disconnected. Telegram can receive web-originated approvals after its allowed users have started private chats with the Telegram bot.

## 2. A morning briefing workflow delivered to Telegram

Goal: send a short plan from a local file to your private Telegram chat at 08:00 Toronto time. This example needs no external news service or model-controlled network calls.

1. Finish the five Telegram setup steps. Send `/start` to your bot. For this private-chat example, use the numeric user ID the bot reported as your delivery `chatId`. Group chat IDs are different; do not use a group for this exercise.
2. In the Assistant bot's working directory, create `briefing-notes.md` yourself with a few tasks and dates. In **Bots → Assistant**, select a working model, enable `read_file`, and leave `read` on **auto**. Confirm the working directory contains that file.
3. In **Workflows**, choose **New from template**. Set the name to `morning-briefing`. Replace its YAML with the following, changing the quoted `chatId` to your own numeric ID:

   ```yaml
   name: morning-briefing
   description: A short plan from my local notes
   trigger:
     type: cron
     expression: "0 8 * * *"
     timezone: America/Toronto
   bot: assistant
   prompt: >-
     Read briefing-notes.md with read_file. Write a concise morning briefing
     with the three most useful next actions. Use only that file. If it is
     missing or empty, say so. Do not fetch the web or change any files.
   deliver:
     - channel: telegram
       chatId: "123456789"
   approval: inherit
   freshSession: true
   ```

4. Save. Check that there is no parse error and that **Next run** is the expected date and time. The UI may display the time in your browser's timezone; the YAML schedule uses `America/Toronto`.
5. Choose **Run now**. This uses the real model and sends a real Telegram message. Wait for the message headed `Workflow morning-briefing (manual)` and verify its contents against your notes.
6. Leave Switchboard and Telegram running. At the next scheduled time, the header says `(cron)`. Use the VPS instructions in SETUP if your laptop sleeps overnight. Delete the workflow when you no longer want the schedule.

`freshSession: true` starts the workflow with an empty conversation each run. `approval: inherit` uses the bot policy. `never` blocks tools that would ask; `auto` bypasses **ask** policies for that workflow, but does not override **never**. Keep `inherit` while learning.

Workflow delivery happens after the run through its configured `deliver` destinations. It does not request a separate `messaging` tool approval. Saving this YAML authorizes that scheduled delivery. A delivery failure is written to daemon logs; a successful model result alone does not prove Telegram received it. The scheduler does not replay missed runs after downtime.

For a news briefing, you can later enable `web_fetch` and ask for named source URLs. With the default **ask** network policy, someone must approve those requests before their timeout. Do not turn every category to **auto** just to avoid a morning prompt.

## 3. Teach a bot a skill

Goal: save a reusable checklist, then load it in a fresh conversation. A skill is a local Markdown instruction file, not trained model weights.

1. In **Bots → Coder**, enable `save_skill` and `load_skill`. Set skills to **all** and `self-modify` to **ask**. Save.
2. Start a new Coder chat and send:

   ```text
   Use save_skill to save this reusable skill.
   name: review-small-change
   description: Review a small code diff for correctness and useful checks.
   body:
   1. Read the changed code and the immediate callers.
   2. Identify one concrete failure case, or say none was found.
   3. Suggest the smallest useful verification command.
   4. Report findings before style suggestions. Do not edit files.
   ```

3. Inspect the `save_skill` approval, including its name, description, and body. Approve if they match. Names use lowercase letters, digits, and single hyphens. Saving an existing name overwrites that user skill, so choose a new name if you want to preserve it.
4. Open **Skills** and choose **Reload**. This step matters: the current `save_skill` tool writes the file but does not automatically refresh the daemon's skill registry. Open `review-small-change` and inspect its instructions. User skills live under `~/.switchboard/skills/<name>/SKILL.md` by default.
5. Start a **new** Coder chat. Send: `Load review-small-change with load_skill, then tell me the four steps without changing any files.` Check that the transcript contains a `load_skill` call and the reply follows the saved body.
6. If a bot uses a selected skills list instead of **all**, add the new skill in its bot editor. Use the **Skills** editor to revise a user skill, then start a new chat to pick up the current metadata. A user skill with a bundled skill's name overrides the bundled one.

Do not put API keys or other secrets in skills. Review instructions imported from elsewhere before giving a bot access to them.

## 4. Cheap models for cheap tasks

Goal: use two providers with separate budgets, while understanding what Switchboard can measure.

1. Add OpenRouter and local Ollama using SETUP. Keep Ollama running with an installed model. In **Settings → Providers**, refresh models and inspect current input/output prices for the paid provider.
2. Create two bots in **Bots**, using the values below. Choose the actual model IDs from your provider lists; availability and prices change.

   | Field | Local summarizer | Paid coding reviewer |
   | --- | --- | --- |
   | ID | `local-summary` | `coding-review` |
   | Name | Local summary | Coding review |
   | Provider | `ollama` | `openrouter` |
   | Model | Your installed model, e.g. `qwen3:8b` | A tool-capable model you can afford |
   | System prompt | Summarize the supplied text in three factual bullets. Do not invent details. | Read the requested files and explain concrete bugs with evidence. Ask before making changes. |
   | Thinking | off | off initially |
   | Tools | none | `read_file`, `list_dir` |
   | Skills | none | none |
   | Memory | off | off |
   | Monthly budget USD | 1 | 5 |
   | Policy | read auto; other categories never | read auto; other categories never |

3. Give the paid reviewer a dedicated working directory. Save both bots. A budget of `0` means **no cap**, so use a positive value for a cap.
4. Start a new chat with Local summary and paste a short paragraph. Check the response. Start another chat with Coding review and ask it to read one file in its working directory. Check its tool result and reply.
5. Compare the cost/tokens under the replies and monthly spend on the bot cards. Use the cheaper bot for routine summaries and the stronger model only when the task benefits. In Telegram or Discord you can switch with `/bot local-summary` and `/bot coding-review`.
6. Check the provider's own billing dashboard. Set a provider-side spending limit for the paid account. Switchboard's budget is a guardrail based on recorded estimates, not a prepaid balance.

The daemon checks accumulated monthly cost before each new run. One run can overshoot the remaining amount, and concurrent sessions can overshoot together. Catalog pricing may differ from billed costs. OpenAI-compatible providers, including Ollama, currently use zero prices in Switchboard: the local bot's $1 setting cannot enforce an electricity, hosting, or custom API bill. The UI's $0 does not mean a remote compatible provider is free.

When you change the global default, any bot still using the previous default follows the new model, including a custom bot. Bots using a different model keep that choice. Check both bot cards after changing the default, and use their individual editors to keep the intended split between providers. The Get started option to update built-in bots also replaces differing model choices on Assistant, Coder, and Guide.
