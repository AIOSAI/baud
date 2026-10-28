/** BAUD's own Chrome: down with two doors, or running with its open pages. Reference: docs/desktop/browser.md */

import { useCallback, useEffect, useRef, useState } from "react";

import { browserAdopt, browserLaunch, browserStatus } from "../host";
import type { BrowserStatus } from "../types";
import { whileVisible } from "./lib/whileVisible";

const POLL_MS = 5000;

const sentence = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export default function BrowserScreen({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [pressing, setPressing] = useState<"launch" | "adopt" | null>(null);
  /** One read at a time: a launch holds the host for up to ten seconds. */
  const reading = useRef(false);

  const read = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    try {
      setStatus(await browserStatus());
      setSaid(null);
    } catch (error) {
      setSaid(sentence(error));
    } finally {
      reading.current = false;
    }
  }, []);

  useEffect(() => whileVisible(() => void read(), POLL_MS), [read]);

  const press = async (door: "launch" | "adopt") => {
    setPressing(door);
    setSaid(null);
    try {
      setStatus(await (door === "launch" ? browserLaunch() : browserAdopt()));
    } catch (error) {
      setSaid(sentence(error));
    } finally {
      setPressing(null);
    }
  };

  const running = status?.state === "running";

  return (
    <section className="baud-phone-reader baud-browser">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ wheel
        </button>
        <span className="baud-phone-reader-title">
          this machine · <b className="baud-browser-accent">BROWSER</b>
        </span>
      </header>

      {status === null && said === null ? <p className="baud-browser-line">reading BAUD's Chrome…</p> : null}

      {status && !running ? (
        <div className="baud-browser-empty">
          <p className="baud-browser-line">
            {status.state === "down" ? "BAUD's Chrome is not running" : `BAUD's Chrome is ${status.state}`}
          </p>
          {status.detail ? <pre className="baud-browser-detail">{status.detail}</pre> : null}
          {status.state === "foreign" ? null : (
            <div className="baud-browser-doors">
              <button
                type="button"
                className="baud-browser-door"
                disabled={pressing !== null}
                onClick={() => void press("launch")}
              >
                {pressing === "launch" ? "launching…" : "launch"}
              </button>
              <button
                type="button"
                className="baud-browser-door"
                disabled={pressing !== null}
                onClick={() => void press("adopt")}
              >
                {pressing === "adopt" ? "copying…" : "adopt my Chrome"}
              </button>
              <p className="baud-browser-hint">copies ~/.config/google-chrome into BAUD's profile, the old one kept aside; close Chrome first</p>
            </div>
          )}
        </div>
      ) : null}

      {status && running ? (
        <>
          <p className="baud-browser-where">
            port {status.port} · {status.profile} · native hosts {status.native_hosts}
          </p>
          {status.detail ? <p className="baud-browser-line">{status.detail}</p> : null}
          <ul className="baud-browser-pages">
            {status.targets.map((page) => (
              <li key={page.id} className="baud-browser-page">
                <span className="baud-browser-title">{page.title || "untitled"}</span>
                <span className="baud-browser-url">{page.url}</span>
              </li>
            ))}
          </ul>
          {status.targets.length === 0 ? <p className="baud-browser-line">no pages open</p> : null}
          <div className="baud-browser-doors">
            <button type="button" className="baud-browser-door" onClick={() => void read()}>
              reload
            </button>
          </div>
        </>
      ) : null}

      {said ? <p className="baud-browser-said">{said}</p> : null}
    </section>
  );
}
