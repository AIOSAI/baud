/**
 * INBOX - what the card's MAIL tile opens, and where a bell row's message
 * lands (DPLAN-0414 T1, A#2; owner 14:23: "If clicked the full text should
 * show.").
 *
 * The tile used to open `.ai_mail.local/inbox.json` raw in the plain reader.
 * This is the memory screen's pattern over that same file: read through the
 * named-file lane, parsed here (`lib/inbox.ts`), drawn as a list, newest first,
 * the unread ones marked. No new route - @api is a gateway (compass #293).
 *
 * THE MESSAGE IS A SECOND SCREEN, not an in-place expand, and that was the
 * choice the brief left open. A mail in this fleet runs to pages - briefs,
 * reports, diffs pasted whole - and the ruling is the FULL text. Expanded in
 * place, a long message pushes every row under it off the bottom and leaves
 * the reader halfway down a list with no head saying which message this is.
 * As its own screen it gets the reader shell's own sticky head (subject, from,
 * time) and the whole height, and `‹ inbox` returns to the list exactly where
 * it was. It is the same component and the same read: no second fetch.
 *
 * TWO WAYS IN. The MAIL tile opens the list. A bell row (contract C-A: a mail
 * event carries `mail_id` and `recipient`) opens straight onto that message,
 * and there `‹ feed` closes the whole screen - the operator came from the
 * feed, and the feed is where back should land. A message the inbox no longer
 * holds (archived, trimmed) says so in one line rather than showing nothing.
 *
 * READ-ONLY. Opening a message here does not mark it read: that is a write to
 * the agent's mailbox, and this face reads.
 *
 * NAMES, NEVER PATHS: `reply_path` is a host path and is never drawn, and the
 * PROJECT IS NAMED, for the memory screen's reason.
 */

import { useEffect, useRef, useState } from "react";

import { relativeAge } from "../age";
import { readFileText } from "../host";
import { INBOX_EMPTY, type Inbox, MESSAGE_GONE, findMessage, inboxHead, readInbox } from "./lib/inbox";
import { useSystemBack } from "./lib/systemBack";

/** The file behind the tile, by the name @api's fence takes. */
const MAIL_FILE = ".ai_mail.local/inbox.json";

interface InboxScreenProps {
  /** The branch whose inbox this is. */
  branch: string;
  /** Which project that branch lives in. Empty means the seat. */
  project: string;
  /**
   * Open straight onto this message - the bell row's door. Absent opens the
   * list, which is what the tile does.
   */
  openId?: string;
  /**
   * The word after `‹` when back CLOSES the screen (DPLAN-0414 wave 6, item
   * 10): `feed` off the bell, `card` off the MAIL tile. A message opened from
   * the list says `inbox`, its own level. Absent is `back`.
   */
  closeLabel?: string;
  onClose: () => void;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function InboxScreen({ branch, project, openId, closeLabel = "back", onClose }: InboxScreenProps) {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The message on screen, by id - or null for the list. */
  const [opened, setOpened] = useState<string | null>(openId ?? null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Mounting IS opening: every open re-reads, so a message that arrived while
  // the screen was shut is on the list the first time it is drawn.
  useEffect(() => {
    setInbox(null);
    setError(null);
    readFileText(`${branch}/${MAIL_FILE}`, project)
      .then((read) => {
        if (!alive.current) return;
        try {
          setInbox(readInbox(JSON.parse(read.content)));
        } catch (err) {
          // A malformed inbox is the agent's news, not a BAUD fault.
          setError(`inbox.json is not readable JSON: ${message(err)}`);
        }
      })
      .catch((err) => {
        // @api's own sentence, verbatim - a fence that refuses says why.
        if (alive.current) setError(message(err));
      });
  }, [branch, project]);

  /* Back from a message opened off the bell closes the screen (the feed is
     underneath); back from a message opened off the list returns to it. */
  const back = () => {
    if (opened !== null && !openId) setOpened(null);
    else onClose();
  };
  /** Where `back` lands, in one word: the list, or wherever the screen closes to. */
  const backLabel = opened !== null && !openId ? "inbox" : closeLabel;

  /* THE PHONE'S OWN BACK IS THIS CHIP (wave 6, item 2), message to list
     included - the level is this screen's to know. */
  useSystemBack(back);

  const shown = opened !== null && inbox ? findMessage(inbox, opened) : null;

  return (
    <section className="baud-phone-reader">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={back}>
          ‹ {backLabel}
        </button>
        <span className="baud-phone-reader-title">
          {opened !== null && shown ? shown.subject : `${branch} · inbox`}
        </span>
      </header>

      {error ? (
        <p className="baud-phone-error" role="alert">
          {error}
        </p>
      ) : inbox === null ? (
        <p className="baud-phone-empty">reading…</p>
      ) : opened !== null ? (
        shown ? (
          <article className="baud-inbox-message">
            {/* The head the brief names: subject, from, timestamp - the
                timestamp as the file wrote it, because an age alone loses the
                hour a message was sent and the hour is often the point. */}
            <div className="baud-inbox-message-head">
              <p className="baud-inbox-message-subject">{shown.subject}</p>
              <p className="baud-inbox-message-meta">
                from {shown.from}
                {shown.timestamp ? ` · ${shown.timestamp}` : ""}
              </p>
            </div>
            {/* The FULL text, wrapped: `baud-phone-text` is the reader's own
                pre-wrap, so long lines wrap and nothing scrolls sideways. */}
            <pre className="baud-phone-text">{shown.message}</pre>
          </article>
        ) : (
          <p className="baud-phone-empty">{MESSAGE_GONE}</p>
        )
      ) : (
        <div className="baud-mem-body">
          {/* The fuller count lives here; the tile keeps `new_mail`. */}
          <p className="baud-list-head">{inboxHead(inbox)}</p>
          {inbox.messages.length === 0 ? (
            <p className="baud-phone-empty">{INBOX_EMPTY}</p>
          ) : (
            <ol className="baud-mem-entries">
              {inbox.messages.map((each, index) => (
                <li key={`${each.id}-${index}`}>
                  <button
                    type="button"
                    className={`baud-mem-entry ${each.unread ? "baud-inbox-unread" : ""}`}
                    onClick={() => setOpened(each.id)}
                  >
                    <span className="baud-mem-entry-head">
                      {each.unread ? <b>unread</b> : null}
                      <span>{each.from}</span>
                      {each.timestamp ? <span>{relativeAge(each.timestamp).label}</span> : null}
                    </span>
                    <span className="baud-mem-entry-key">{each.subject}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
