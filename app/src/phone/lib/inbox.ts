/** An agent's inbox (`.ai_mail.local/inbox.json`), parsed for InboxScreen; pure.
 * `reply_path`, `auto_execute` and `sent_id` are dropped in the parse so no render can leak a host path. */

export interface InboxMessage {
  id: string;
  /** As written: `2026-10-15 23:59:31`, naive local time. "" when absent. */
  timestamp: string;
  from: string;
  subject: string;
  message: string;
  unread: boolean;
}

export interface Inbox {
  messages: InboxMessage[];
  unread: number;
  total: number;
}

export const NO_SENDER = "unknown sender";
export const NO_SUBJECT = "(no subject)";
export const NO_TEXT = "this message carries no text";

export const MESSAGE_GONE = "this message is no longer in the inbox — archived or trimmed since the bell rang";

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
    // Only an explicit `read: false` is unread; a missing field is not news the file stated.
    unread: row.read === false,
  };
}

// `YYYY-MM-DD HH:MM:SS` sorts as a string exactly as a time; ties reverse file order (the file is appended to).
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

export function inboxHead(inbox: Inbox): string {
  return `${inbox.unread} unread · ${inbox.total} total`;
}

export function findMessage(inbox: Inbox, id: string): InboxMessage | null {
  return inbox.messages.find((message) => message.id === id) ?? null;
}

/** Where a bell row's message lives: needs both `mail_id` and `recipient` (docs/phone/settings-nav.md), else null. */
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
