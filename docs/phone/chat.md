# The chat: one agent's transcript and a box to talk to it

This page covers the chat screen the card's `chat` door opens: what it shows, what it polls, and what it leaves to the Chrome extension.

← [the phone face](../phone.md)

### What the screen is

**The extension's side panel, one agent, full height.** `ChatSheet.tsx` opens
over the stage like the memory screen, with `‹` back to the card. It is the same
chat as [the extension's](../extension.md) and reads the same host verbs; the
rules are the extension's own, imported from `extension/lib/chat.ts` and
`extension/lib/pending.ts` rather than copied, so a fix there lands on both.

- **The feed** is the agent's transcript. A reply renders as markdown through
  `lib/markdown.ts` and its sanitizer; every other line is text with only
  http(s) URLs linked. Consecutive tool calls stack into one line; a tap opens
  the stack. A code box copies on a tap and says "copied" for a moment; over
  plain http the copy takes `lib/copyPath.ts`'s legacy lane, and a refused copy
  shows no flash.
- **The list scrolls to the newest line** on open and on every new line, unless
  the reader has scrolled up more than 40 px.
- **The composer is pinned to the bottom.** The page does not resize under the
  soft keyboard (see `phone.html`), so the screen raises its own bottom by what
  the keyboard hides from the visual viewport. Enter is a newline; `➤` sends,
  `■` stops the agent.
- **A sent line is pending** under the feed, "sent · waiting for <name>", until
  the feed shows a user line opening with its words. After 90 s it reads "not
  delivered" with resend and discard; a send the host refused (409 when the agent
  has no room) says why, with the same two choices.
- **Allow and deny** appear when the feed says the agent waits on a tool. The
  answer shows for 3 s, then the line stays quiet until the feed's state changes.
- **Read-aloud** sits under each reply: `▶` plays it through the host's Piper
  stream (`speak`), then `⏸`/`▶` pause and resume, `↺` goes back 10 s and `■`
  stops. The player is the extension's own (`extension/panel/voice.ts`), one per
  screen: a new play stops the old, and closing the screen stops it. The audio
  context is made inside the tap, since a phone keeps a context made later
  silent. Web Audio needs no secure context, so it works over plain http. A
  refused read shows "read aloud: …" above the composer.
- **The model label** in the head is the newest reply's model, or the provider
  `agentUsage` reports before any reply. A tap opens the model menu under the
  head, the extension's `Menus.tsx` shaped for touch: the provider chips, the
  catalog from `modelsList` with each model's effort levels, and under another
  provider a handoff to that CLI. A pick goes out through `agentModel`; the
  answer shows above the composer, "switched <name> to Opus high, typed
  /model opus; pending its next reply", or the refusal in words (409: "<name>
  is working; the model can change when it stops"). While the agent works the
  rows are disabled.
- **The usage ring** beside the label fills with the context window's share
  and turns amber or red with the worst plan limit. A tap opens the usage sheet:
  the context window in tokens, each plan limit with its reset time, and the
  host's note or the read's error.
- **A photo** goes in with `+`: the phone's picker, `uploadImage`, and an
  `[Image #n]` tag at the cursor. On send each tag becomes the uploaded file's
  host path, as the extension's `resolveImages` does; the pending line and the
  echoed line show the tag. The picker takes no `capture` attribute, which would
  lock out screenshots, and its value clears after each pick so the same photo
  can go twice. The picker backgrounds the app, which pauses the polls; they
  tick again on return, and the upload is a plain request with no socket to lose.
- **Errors show inline**: a failed feed read in the list, a refused allow, deny
  or stop above the composer.

### What it polls

`agentFeed` every 2 s while the page is visible (`lib/whileVisible.ts`), asking
only for lines after the newest it holds; a new transcript (`session` changes)
starts the count over. A send, an answer or a stop asks again 0.6 s later.
`agentUsage` on open and every 30 s while the page is visible; a failed read
keeps the last numbers and shows the error in the sheet. `modelsList` is read
each time the model menu opens. Nothing polls once the screen closes.

### What it leaves to the extension

The Looking-at line, the screenshot button, image drop and paste, the agent tab
row, the orb, Interact, and hold-Space dictation (on the phone the keyboard's own
mic dictates). Esc to stop is a desktop key; the phone has `■`. Copying a whole
reply stays the extension's; on the phone a code box copies on a tap.
