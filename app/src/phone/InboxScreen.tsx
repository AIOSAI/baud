/** The MAIL tile's inbox list and the bell row's door onto one message (its own screen: mail runs to pages).
 * Read-only: opening a message never marks it read, since that would write the agent's mailbox. */

import { useEffect, useRef, useState } from "react";

import { relativeAge } from "../age";
import { readFileText } from "../host";
import { INBOX_EMPTY, type Inbox, MESSAGE_GONE, findMessage, inboxHead, readInbox } from "./lib/inbox";
import { useSystemBack } from "./lib/systemBack";

const MAIL_FILE = ".ai_mail.local/inbox.json";

interface InboxScreenProps {
  branch: string;
  /** Which project that branch lives in. Empty means the seat. */
  project: string;
  /** Open straight onto this message (the bell row's door); absent opens the list. */
  openId?: string;
  /** The word after `‹` when back closes the screen: `feed` off the bell, `card` off the tile. */
  closeLabel?: string;
  onClose: () => void;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function InboxScreen({ branch, project, openId, closeLabel = "back", onClose }: InboxScreenProps) {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(openId ?? null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Every open re-reads, so mail that arrived while the screen was shut is listed.
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
        if (alive.current) setError(message(err));
      });
  }, [branch, project]);

  // Off the bell, back closes the screen (the feed is underneath); off the list, it returns to the list.
  const back = () => {
    if (opened !== null && !openId) setOpened(null);
    else onClose();
  };
  const backLabel = opened !== null && !openId ? "inbox" : closeLabel;

  // The system back is this chip, message to list included: the level is this screen's to know.
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
            {/* The timestamp as written, not an age: the hour sent is often the point. */}
            <div className="baud-inbox-message-head">
              <p className="baud-inbox-message-subject">{shown.subject}</p>
              <p className="baud-inbox-message-meta">
                from {shown.from}
                {shown.timestamp ? ` · ${shown.timestamp}` : ""}
              </p>
            </div>
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
