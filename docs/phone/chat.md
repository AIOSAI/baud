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
- **The model label** in the head is the newest reply's model, or the provider
  `agentUsage` reports before any reply.
- **Errors show inline**: a failed feed read in the list, a refused allow, deny
  or stop above the composer.

### What it polls

`agentFeed` every 2 s while the page is visible (`lib/whileVisible.ts`), asking
only for lines after the newest it holds; a new transcript (`session` changes)
starts the count over. A send, an answer or a stop asks again 0.6 s later.
`agentUsage` is read once on open. Nothing polls once the screen closes.

### What it leaves to the extension

The Looking-at line, images and the screenshot button, the agent tab row, the
orb, read-aloud and dictation, the usage ring and the model menu. The extension's
model picker is where the model changes.
