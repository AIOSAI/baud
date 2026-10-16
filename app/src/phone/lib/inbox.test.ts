import { describe, expect, it } from "vitest";

import {
  MESSAGE_GONE,
  NO_SENDER,
  NO_SUBJECT,
  NO_TEXT,
  findMessage,
  inboxHead,
  mailAddress,
  readInbox,
} from "./inbox";

const message = (over: Record<string, unknown>) => ({
  id: "01c2c5e2",
  timestamp: "2026-10-15 23:59:31",
  from: "@drone",
  from_name: "drone",
  subject: "RE: untrack",
  message: "line one\nline two",
  status: "opened",
  read: true,
  priority: "normal",
  sent_id: "s-1",
  reply_path: "/home/someone/.ai_mail.local/inbox.json",
  auto_execute: false,
  ...over,
});

describe("readInbox", () => {
  it("puts the newest message first by timestamp, whatever the file order", () => {
    const inbox = readInbox({
      messages: [
        message({ id: "a", timestamp: "2026-10-14 08:00:00" }),
        message({ id: "b", timestamp: "2026-10-16 09:00:00" }),
        message({ id: "c", timestamp: "2026-10-15 12:00:00" }),
      ],
    });
    expect(inbox.messages.map((each) => each.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks a timestamp tie by file position, the later line first", () => {
    const inbox = readInbox({
      messages: [
        message({ id: "first", timestamp: "2026-10-15 12:00:00" }),
        message({ id: "second", timestamp: "2026-10-15 12:00:00" }),
      ],
    });
    expect(inbox.messages.map((each) => each.id)).toEqual(["second", "first"]);
  });

  it("sorts a message with no timestamp last", () => {
    const inbox = readInbox({
      messages: [message({ id: "bare", timestamp: undefined }), message({ id: "dated" })],
    });
    expect(inbox.messages.map((each) => each.id)).toEqual(["dated", "bare"]);
  });

  it("carries the full message text, untouched", () => {
    const long = "x".repeat(5000) + "\n\nthe end";
    expect(readInbox({ messages: [message({ message: long })] }).messages[0].message).toBe(long);
  });

  it("marks unread only when read is false", () => {
    const inbox = readInbox({
      messages: [
        message({ id: "new", read: false, timestamp: "2026-10-16 03:00:00" }),
        message({ id: "seen", read: true, timestamp: "2026-10-16 02:00:00" }),
        message({ id: "silent", read: undefined, timestamp: "2026-10-16 01:00:00" }),
      ],
    });
    expect(inbox.messages.map((each) => each.unread)).toEqual([true, false, false]);
  });

  it("never carries reply_path, sent_id or auto_execute out of the parse", () => {
    const parsed = readInbox({ messages: [message({})] }).messages[0] as unknown as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["from", "id", "message", "subject", "timestamp", "unread"]);
  });

  it("names the sender by from_name, then by from without its @", () => {
    const inbox = readInbox({
      messages: [
        message({ id: "named", from_name: "drone", timestamp: "2026-10-16 02:00:00" }),
        message({ id: "bare", from_name: undefined, from: "@devpulse", timestamp: "2026-10-16 01:00:00" }),
      ],
    });
    expect(inbox.messages.map((each) => each.from)).toEqual(["drone", "devpulse"]);
  });

  it("prefers from_name over from when the two differ", () => {
    expect(readInbox({ messages: [message({ from_name: "Drone", from: "@drone" })] }).messages[0].from).toBe("Drone");
  });

  it("reads an empty subject as a missing one", () => {
    expect(readInbox({ messages: [message({ subject: "" })] }).messages[0].subject).toBe(NO_SUBJECT);
  });

  it("states every missing field in words", () => {
    const parsed = readInbox({ messages: [{ id: "x" }] }).messages[0];
    expect(parsed.from).toBe(NO_SENDER);
    expect(parsed.subject).toBe(NO_SUBJECT);
    expect(parsed.message).toBe(NO_TEXT);
    expect(parsed.timestamp).toBe("");
  });

  it("takes the counts the file states", () => {
    const inbox = readInbox({ total_messages: 14, unread_count: 2, messages: [message({})] });
    expect(inbox.total).toBe(14);
    expect(inbox.unread).toBe(2);
  });

  it("counts from the list when the file states no counts", () => {
    const inbox = readInbox({
      messages: [message({ id: "a", read: false }), message({ id: "b", read: true })],
    });
    expect(inbox.total).toBe(2);
    expect(inbox.unread).toBe(1);
  });

  it("counts from the list when a stated count is negative", () => {
    const inbox = readInbox({ total_messages: -1, unread_count: -3, messages: [message({ read: false })] });
    expect(inbox.total).toBe(1);
    expect(inbox.unread).toBe(1);
  });

  it("reads a file with no messages array as an empty inbox", () => {
    expect(readInbox({ mailbox: "x" })).toEqual({ messages: [], unread: 0, total: 0 });
  });

  it("reads null as an empty inbox", () => {
    expect(readInbox(null)).toEqual({ messages: [], unread: 0, total: 0 });
  });
});

describe("inboxHead", () => {
  it("reads N unread · M total", () => {
    expect(inboxHead({ messages: [], unread: 2, total: 14 })).toBe("2 unread · 14 total");
  });
});

describe("findMessage", () => {
  const inbox = readInbox({ messages: [message({ id: "01c2c5e2" }), message({ id: "99" })] });

  it("finds the message by id", () => {
    expect(findMessage(inbox, "99")?.id).toBe("99");
  });

  it("is null when the inbox no longer holds it", () => {
    expect(findMessage(inbox, "gone")).toBe(null);
  });

  it("says why in one line", () => {
    expect(MESSAGE_GONE).toBe("this message is no longer in the inbox — archived or trimmed since the bell rang");
  });
});

describe("mailAddress", () => {
  it("is a door when the event carries both keys", () => {
    expect(mailAddress({ mail_id: "01c2c5e2", recipient: "devpulse" })).toEqual({
      recipient: "devpulse",
      mailId: "01c2c5e2",
    });
  });

  it("drops a stray @ from the recipient", () => {
    expect(mailAddress({ mail_id: "01c2c5e2", recipient: "@devpulse" })?.recipient).toBe("devpulse");
  });

  it("is not a door without mail_id", () => {
    expect(mailAddress({ recipient: "devpulse" })).toBe(null);
  });

  it("is not a door without recipient", () => {
    expect(mailAddress({ mail_id: "01c2c5e2" })).toBe(null);
  });

  it("is not a door when a key is empty", () => {
    expect(mailAddress({ mail_id: "", recipient: "devpulse" })).toBe(null);
    expect(mailAddress({ mail_id: "01c2c5e2", recipient: "" })).toBe(null);
  });

  it("is not a door when a key is not a string", () => {
    expect(mailAddress({ mail_id: 7, recipient: "devpulse" })).toBe(null);
  });

  it("carries the recipient's project when the event names one", () => {
    expect(mailAddress({ mail_id: "01c2c5e2", recipient: "baud", project: "baud" })).toEqual({
      recipient: "baud",
      mailId: "01c2c5e2",
      project: "baud",
    });
  });

  it("is still a door without a project, and carries no project key", () => {
    const address = mailAddress({ mail_id: "01c2c5e2", recipient: "devpulse" });
    expect(address).not.toBe(null);
    expect(Object.keys(address ?? {})).toEqual(["recipient", "mailId"]);
  });

  it("drops an empty or non-string project rather than reading the seat as ''", () => {
    expect(Object.keys(mailAddress({ mail_id: "01c2c5e2", recipient: "devpulse", project: "" }) ?? {})).toEqual([
      "recipient",
      "mailId",
    ]);
    expect(Object.keys(mailAddress({ mail_id: "01c2c5e2", recipient: "devpulse", project: 3 }) ?? {})).toEqual([
      "recipient",
      "mailId",
    ]);
  });

  it("is not a door with only a project and no mail_id", () => {
    expect(mailAddress({ recipient: "devpulse", project: "aipass" })).toBe(null);
  });
});
