# The Chrome extension

BAUD's third face, beside the desktop window and the phone: a Chrome side panel
to chat with your agents, and an orb in the corner of any tab you switch on that
shows the fleet and tells the open agent what you are looking at. It talks to
@api's host server, the same server the phone uses, through the phone's own
client (`src/host/transport.http.ts`); there is no Tauri code in it.

## Build and load

```
cd app && npm run build:extension
```

The output is `app/dist-extension/`. In Chrome, `chrome://extensions` →
Developer mode → Load unpacked → that folder. Then run
`drone @api host-api pair extension`: it prints a `Host:` and a one-use
`Pairing code:`. Put both in the extension's options and press `pair`. The page
asks Chrome for permission to reach that one address, posts the code to
`POST /v1/pair` with no bearer, and keeps the token it gets back in
`chrome.storage.local`; no token is ever typed. The host server has no CORS
layer, and the extension's host permission is what lets its pages call it.
`test` calls `GET /v1/roster` with the saved token and shows ok or the error.

The build is two Vite passes over `vite.config.extension.ts`: the pages and the
service worker, then `--mode content`, because a content script cannot be an ES
module and comes out as one classic `content.js`. `manifest.json` and the icon
are copied in. Chrome 116 or newer; the chat input grows with its text from
Chrome 123 (`field-sizing`), and stays one size below that.

## What it does

**The worker** (`background.ts`). The toolbar icon opens the side panel. Ports
from tabs and the panel reconnect after the worker sleeps, and both sides ping
every 20 s. Interact is per tab: http(s) pages only, off by default, and off
again on reload, navigation or close; it is held in the worker's memory, so a
worker restart turns it off everywhere. While a panel is open or any tab has
Interact on, the worker polls `GET /v1/roster` every 5 s, every project's
working agents, and passes the rows to the panel and the orbs. Each row carries
`state` (`idle`, `working`, `waiting`, or null when the host cannot say),
`busy`, `tool`, `model`, `delegating`, and `dispatched` as a boolean.

**The orb** (`content.ts`, `orb.ts`). Drawn in a closed shadow root at about
15 frames a second. Its position is kept per site and clamped to the window.
Its energy follows the agent open in the panel: idle, thinking, acting (a tool
running), waiting, speaking with Piper's loudness; with no panel, the fleet
entry's `busy` stands in. Rings show the fleet: green interactive, orange
dispatched, violet sub-agents, and a working agent's dot pulses. The eyes follow
the pointer and blink. `×` turns the tab off on a click and moves the orb on a
drag. The orb's host element carries inline position styles, the one exception
to BAUD's stylesheet rule: a page's CSS outranks `:host`.

**Looking at.** With the eyes on, the panel holds what the pointer is over (a
heading, link, image alt, list item or table cell), the selection, and a pin
made by dragging the orb onto an element; one pin per window. The page is named
without its query string. An empty target clears the line, and switching or
closing a tab clears that tab's pointer line, so the line is never stale. The
eyes switch stops gathering and keeps the pin; the eyes state and hue live in
`chrome.storage.local` under `eyes`. Every message is checked for its sender and
shape on arrival (`messages.ts`).

**The side panel** (`panel/`). One tab per live interactive agent (dispatched
agents and sub-agents are not chat partners), each with a state dot and a
`project · provider · state` tooltip; the open tab is remembered under
`panelAgent`. The feed polls every 2 s while the panel is visible: the first
read brings the last 80 lines, and each later one asks `since` the last line
held, which the host reads as exclusive. Line numbers restart in a new
transcript, so when the answer's `session` changes the panel drops what it
holds and reads again without `since`. Messages are plain text with http(s) links only;
tool lines collapse into runs; each line shows its time and model. The feed
stays at the bottom only if you were at the bottom, and a poll keeps your
selection.

- Enter sends to the open agent, Shift+Enter makes a newline. A Looking-at line
  rides as the first line, `[Looking at: …]`, exactly as Seed Dev's deck wrote it.
- A send that fails, or meets a 409 because the agent has no room, stays
  pending with the host's words, `resend` (the same text and image tags) and
  `discard`. It settles when the agent's feed shows it.
- The stop button and Esc interrupt the agent. Esc with a menu open closes the
  menu and stops nothing. A busy agent shows a busy line; one waiting on a
  permission names the tool, with `allow` and `deny`.
- The `▾` model menu lists models and efforts, and provider chips hand the agent
  to another CLI; a busy agent refuses with a 409, said in words.
- The usage ring shows the context used, coloured by the worst plan limit;
  a click opens the sheet, with the host's `note` when usage is unavailable.
- Each reply has copy, and Piper read-aloud: play, pause, back 10 s, stop.
  Speech arrives as raw 16-bit mono PCM at the rate in the `X-Sample-Rate`
  header; a missing header is an error, since a guessed rate plays at the wrong
  pitch.
- Holding Space while the input is empty dictates into it through Chrome's own
  speech recognition; it never sends by itself.
- Dropping or pasting an image uploads it and inserts an `[Image #n]` tag;
  anything that is not an image is refused.

## The host routes it uses

`<agent>` is `<project>/<name>`, each segment URL-encoded; the client refuses
any other shape. All bearer-token JSON.

| Route | Use |
|---|---|
| `GET /v1/roster` | tabs, rings, orb fallback |
| `GET /v1/agent/<agent>/feed?since=<n>` | the feed, busy, waiting, session |
| `POST /v1/agent/<agent>/send` | send, resend |
| `POST /v1/agent/<agent>/interrupt` · `/allow` · `/deny` | stop, Esc, permission |
| `GET /v1/models` · `POST /v1/agent/<agent>/model` | the model menu |
| `GET /v1/agent/<agent>/usage` | the usage ring and sheet |
| `POST /v1/speak` | Piper read-aloud |
| `POST /v1/files/upload` | images |
| `POST /v1/pair` | the options page redeems its pairing code, no bearer |

## Files

| File | Holds |
|---|---|
| `src/extension/manifest.json` | MV3: side panel, worker, content script, storage, optional host permission |
| `src/extension/background.ts` · `messages.ts` | the worker; every message shape and its guard |
| `src/extension/content.ts` · `orb.ts` | the page side: Looking at, the orb |
| `src/extension/options.html` · `options/main.ts` | the host and its pairing code |
| `src/extension/sidepanel.html` · `panel/` | the chat: `main.tsx`, `Feed.tsx`, `Menus.tsx`, `voice.ts` (Piper), `dictation.ts`, `port.ts` |
| `src/extension/lib/` | pure helpers with their tests: `chat`, `pending`, `pcm`, `look`, `place`, `tabBook`, `orbState`, `hostConfig` |
| `src/extension/chrome.d.ts` | the Chrome API types it uses, by hand |
| `vite.config.extension.ts` | the build |
