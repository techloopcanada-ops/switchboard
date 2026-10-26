# Web overhaul: shell and layout status

Initial scope: `src/App.tsx`, `src/styles.css`, and this log. Parent then assigned a narrow accessibility follow-up in `src/screens/Chat.tsx` and `src/ConversationList.tsx`. No core, desktop, package, or dependency changes.

Implemented:

- Slim 184px app navigation with a persistent 64px collapsed mode. Mobile uses a top bar and an accessible slide-over; no bottom navigation covers the composer. Escape and focus containment support keyboard use of the app navigation.
- Chat fills the available viewport without the generic page header. `chat-host` stays mounted after config loads and is hidden on other routes. App passes the new Chat props, including default bot, nonce-based requested bot, approvals, refresh callback, and visibility.
- `skill_learned` produces `Learned: <name>`. Notifications occupy a bounded row above content, never an overlay above the composer.
- The visual viewport height drives the shell, including when a mobile keyboard changes the usable area. The composer has explicit background/text/caret colors, 16px / 24px typography, a focus ring, up to eight lines plus padding, and a lower height cap on short viewports.
- Responsive conversation pane, compact timeline, plain assistant markdown, soft user bubbles, code-copy toolbars, inline approvals/skill suggestions, lighter cards, both color schemes, and reduced-motion support. Existing settings/onboarding/Pair layouts remain styled.

Commands from `switchboard`:

```powershell
npm run typecheck -w apps/web
```

Initial result: one expected integration error because App used the new Chat contract before the parent agent replaced the old Chat props. No other type errors were reported. Repeat after integration.

Composer contrast self-check:

```powershell
node -e 'const assert=require("node:assert/strict"); function luminance(hex){const rgb=hex.match(/[a-f0-9]{2}/gi).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722} for(const [name,fg,bg] of [["light","23382e","ffffff"],["dark","e3eee6","1a281f"]]){const ratio=(Math.max(luminance(fg),luminance(bg))+.05)/(Math.min(luminance(fg),luminance(bg))+.05); assert.ok(ratio>=4.5); console.log(name+" composer contrast "+ratio.toFixed(2)+":1")}'
```

Result: light 12.53:1, dark 12.90:1 (minimum required 4.5:1).

Integrated checks from `switchboard`, repeated after the final layout and mobile focus fixes:

```powershell
npm run typecheck -w apps/web
npm run build -w apps/web
```

Both pass. Latest local output after the focus follow-up: `index-DfTyjFk3.js` and `index-D2ffXK13.css`. No API blocker.

Accessibility follow-up: opening the mobile conversation drawer focuses its first control; Tab/Shift+Tab stay within the live controls (including expanded menu items); the chat panel is inert only while this mobile modal is open. Escape, its backdrop, and Close restore focus to the Chats trigger. Selecting a conversation preserves the existing composer-focus behavior. Changing route or resizing wide closes the modal. The drawer has dialog semantics only in its mobile modal state. App navigation can supersede it without competing focus traps.

Parent owns the integrated browser checks at 360px/1280px and in light/dark themes, including drawer focus assertions. This agent did not launch a separate browser session or touch the running preview's data.

Browser follow-up from parent: the first focus attempt occurred while the slide-over was still visibility-hidden; it also found hidden controls inside closed menus in the focus list. Fixed by scheduling initial focus after two animation frames, checking computed visibility/inert ancestors, and excluding closed-details contents while retaining its summary. Reran the same typecheck/build commands above; both pass. Parent is rechecking focus entry, wrapping, and return in the browser.
