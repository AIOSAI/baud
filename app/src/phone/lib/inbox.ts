/**
 * An agent's inbox, read the memory screen's way (DPLAN-0414 T1, A#2).
 *
 * The MAIL tile used to open `.ai_mail.local/inbox.json` raw. The owner's
 * ruling for every designed read is the one the memory screen already follows:
 * read the file through the files lane, parse it here, draw a list. No new
 * route - @api is a gateway (compass #293), and the file is already readable.
 *
 * PURE, so the words and the order are tested without a browser. The screen
 * (`InboxScreen.tsx`) only draws what these return.
 *
 * WHAT IS NEVER SHOWN, on purpose: `reply_path` is a host path and this face
 * shows names, never paths; `auto_execute` and `sent_id` are plumbing. They are
 * not even carried out of the parse, so no render can leak them by accident.
 */

/** One message, as the screen draws it. */
export interface InboxMessage {
  id: string;
  /** As written: `2026-10-15 23:59:31`, naive local time. "" when absent. */
  timestamp: string;
  from: string;
  subject: string;
  /** The FULL text - the owner's words: "If clicked the full text should show." */
  message: string;
  unread: boolean;
}

export interface Inbox {
  /** Newest first. */
  messages: InboxMessage[];
  unread: number;
  total: number;
}

/** A message missing a field says so in words, never as a blank. */
export const NO_SENDER = "unknown sender";
export const NO_SUBJECT = "(no subject)";
export const NO_TEXT = "this message carries no text";

/** The one-line answer when the bell names a message the inbox no longer has. */
export const MESSAGE_GONE = "this message is no longer in the inbox — archived or trimmed since the bell rang";

/** The list's empty state. */
export const INBOX_EMPTY = "no messages in this inbox";

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

function readMessage(raw: unknown): InboxMessage {
  const row = (raw ?? {}) as Record<string, unknown>;
  const from = text(row.from_name) ?? text(row.from)?.replace(/^@/, "") ?? NO_SENDER;
  return {
    id: typeof row.id === "string" || typeof row.id === "number" ? String(row.id) : "",
    timestamp: text(row.timestamp) ?? "",
    from,
    subject: text(row.subject) ?? NO_SUBJECT,
    message: text(row.message) ?? NO_TEXT,
    // `read: false` is the one shape that earns the mark. A message with no
    // `read` field at all is not news the file told us, so it is not drawn as
    // unread.
    unread: row.read === false,
  };
}

/**
 * The parsed inbox: newest first by `timestamp`, and the counts the file
 * states, or counted from the list when it states none.
 *
 * The timestamps are `YYYY-MM-DD HH:MM:SS`, which sort as strings exactly as
 * they sort as times - no Date parsing to disagree with the file. A message
 * without one sorts last. Ties keep the file's own order, reversed, because
 * the file is appended to and the later line is the later message.
 */
export function readInbox(raw: unknown): Inbox {
  const doc = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(doc.messages) ? doc.messages.map(readMessage) : [];
  const messages = rows
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      if (a.message.timestamp !== b.message.timestamp) {
        return a.message.timestamp < b.message.timestamp ? 1 : -1;
      }
      return b.index - a.index;
    })
    .map((entry) => entry.message);
  const count = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
  return {
    messages,
    unread: count(doc.unread_count, messages.filter((message) => message.unread).length),
    total: count(doc.total_messages, messages.length),
  };
}

/** The screen's head: `2 unread · 14 total`. */
export function inboxHead(inbox: Inbox): string {
  return `${inbox.unread} unread · ${inbox.total} total`;
}

/** The message with this id, or null when the inbox no longer holds it. */
export function findMessage(inbox: Inbox, id: string): InboxMessage | null {
  return inbox.messages.find((message) => message.id === id) ?? null;
}

/**
 * Where a bell row's message lives, or null when the row is not a door.
 *
 * Contract C-A (devpulse `docs.local/baud_review/CONTRACTS.md`): a mail event
 * carries `mail_id` and `recipient` through `send_notification`'s `extra`,
 * which merges them into the event at its top level. BOTH must be present and
 * non-empty: an older line, a wake or a dispatch carries neither and stays the
 * plain row it always was. `recipient` is a branch name without `@`; a stray
 * `@` is dropped rather than sent to the fence as part of a name.
 *
 * `project` (C-A as amended 2026-10-16) is the recipient's project as the
 * registry names it. It is carried only when it is a non-empty string, and it
 * is NOT required: a row without it is still a door, and the caller finds the
 * project the way it did before the amendment.
 */
export function mailAddress(event: { mail_id?: unknown; recipient?: unknown; project?: unknown }): {
  recipient: string;
  mailId: string;
  project?: string;
} | null {
  const mailId = text(event.mail_id);
  const recipient = text(event.recipient)?.replace(/^@/, "") ?? null;
  if (!mailId || !recipient) return null;
  const project = text(event.project);
  return project ? { recipient, mailId, project } : { recipient, mailId };
}
