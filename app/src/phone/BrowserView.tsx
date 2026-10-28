/** The shown page, live: a tab row, a URL bar and a canvas fed by browser.rs's screencast. Reference: docs/desktop/browser.md */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  browserCloseTab,
  browserHistory,
  browserInput,
  browserNavigate,
  browserNewTab,
  browserViewClose,
  browserViewOpen,
  HostChannel,
} from "../host";
import type { BrowserEvent, BrowserInput, BrowserTarget } from "../types";
import { keyInputs, mouseInput, neighbourOf, pagePoint, urlOf, wheelInput } from "./lib/browserInput";

type Frame = Extract<BrowserEvent, { kind: "frame" }>;

const sentence = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const imageOf = (base64: string) =>
  createImageBitmap(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: "image/jpeg" }));

export default function BrowserView({ targets, onChanged }: { targets: BrowserTarget[]; onChanged: () => void }) {
  const [shown, setShown] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const address = useRef<HTMLInputElement>(null);
  const view = useRef<string | null>(null);
  /** The newest undrawn frame; frames that arrive while one decodes replace it, so the tab never falls behind. */
  const latest = useRef<Frame | null>(null);
  /** The frame on the canvas, whose CSS size maps pointer coordinates. */
  const drawn = useRef<Frame | null>(null);
  const busy = useRef(false);

  // Only on a fresh list: a closed view clears `shown`, and the next poll, not this render, reopens one.
  useEffect(() => {
    setShown((current) => (current && targets.some((t) => t.id === current) ? current : (targets[0]?.id ?? null)));
  }, [targets]);

  const draw = useCallback(() => {
    const frame = latest.current;
    const board = canvas.current;
    if (busy.current || !frame || !board) return;
    latest.current = null;
    busy.current = true;
    imageOf(frame.data)
      .then((image) => {
        if (board.width !== image.width) board.width = image.width;
        if (board.height !== image.height) board.height = image.height;
        board.getContext("2d")?.drawImage(image, 0, 0);
        image.close();
        drawn.current = frame;
      })
      .catch(() => {})
      .finally(() => {
        busy.current = false;
        if (latest.current) requestAnimationFrame(draw);
      });
  }, []);

  useEffect(() => {
    if (!shown) return;
    let gone = false;
    let opened: string | null = null;
    const channel = new HostChannel<BrowserEvent>();
    channel.onmessage = (event) => {
      if (gone) return;
      if (event.kind === "frame") {
        const idle = latest.current === null;
        latest.current = event;
        setHidden(false);
        if (idle) requestAnimationFrame(draw);
      } else if (event.kind === "visibility") {
        setHidden(!event.visible);
      } else {
        setSaid(event.reason);
        setShown(null);
      }
    };
    const close = () => {
      if (opened) void browserViewClose(opened).catch(() => {});
    };
    setSaid(null);
    setHidden(false);
    drawn.current = null;
    browserViewOpen(shown, channel)
      .then((id) => {
        opened = id;
        if (gone) close();
        else view.current = id;
      })
      .catch((error) => {
        if (gone) return;
        setSaid(sentence(error));
        setShown(null);
      });
    // A webview reload skips unmount; the stream's thread would read for nobody.
    window.addEventListener("beforeunload", close);
    return () => {
      gone = true;
      view.current = null;
      window.removeEventListener("beforeunload", close);
      close();
    };
  }, [shown, draw]);

  const send = (input: BrowserInput) => {
    if (view.current) void browserInput(view.current, input).catch(() => {});
  };

  const at = (e: { clientX: number; clientY: number }) => {
    const board = canvas.current;
    const frame = drawn.current;
    if (!board || !frame) return null;
    const box = board.getBoundingClientRect();
    return pagePoint(e.clientX - box.left, e.clientY - box.top, box.width, box.height, frame);
  };

  const mouse = (type: "mousePressed" | "mouseReleased" | "mouseMoved") => (e: React.MouseEvent) => {
    const point = at(e);
    if (type === "mousePressed") canvas.current?.focus();
    if (point) send(mouseInput(type, e, point));
  };

  // Native and non-passive: React's wheel listener cannot stop the tab scrolling under the page.
  useEffect(() => {
    const board = canvas.current;
    if (!board) return;
    const onWheel = (e: WheelEvent) => {
      // Ctrl+wheel is BAUD's zoom.
      if (e.ctrlKey) return;
      e.preventDefault();
      const point = at(e);
      if (point) send(wheelInput(e, point));
    };
    board.addEventListener("wheel", onWheel, { passive: false });
    return () => board.removeEventListener("wheel", onWheel);
  });

  // BAUD's zoom keys never arrive here: Zoom.tsx takes them in the capture phase.
  const key = (phase: "down" | "up") => (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    for (const input of keyInputs(phase, e)) send(input);
  };

  const openTab = async () => {
    try {
      const tab = await browserNewTab();
      setShown(tab.id);
      onChanged();
      address.current?.focus();
      address.current?.select();
    } catch (error) {
      setSaid(sentence(error));
    }
  };

  // The shown tab's view ends on Chrome's detach; the row moves to its neighbour now rather than at the next poll.
  const closeTab = async (id: string) => {
    try {
      await browserCloseTab(id);
      if (id === shown) setShown(neighbourOf(targets.map((t) => t.id), id));
      onChanged();
    } catch (error) {
      setSaid(sentence(error));
    }
  };

  const step = (by: -1 | 1) => {
    if (view.current) void browserHistory(view.current, by).catch((error) => setSaid(sentence(error)));
  };

  const go = () => {
    if (draft && view.current) void browserNavigate(view.current, urlOf(draft)).catch((error) => setSaid(sentence(error)));
    setDraft(null);
  };

  const current = targets.find((t) => t.id === shown);

  return (
    <div className="baud-browser-view">
      <div className="baud-browser-tabs">
        {targets.map((t) => (
          <span key={t.id} className={`baud-browser-tab ${t.id === shown ? "baud-browser-tab-on" : ""}`}>
            <button type="button" className="baud-browser-tab-name" title={t.url} onClick={() => setShown(t.id)}>
              {t.title || t.url || "untitled"}
            </button>
            <button
              type="button"
              className="baud-browser-tab-x"
              aria-label={`close ${t.title || t.url || "tab"}`}
              title="close this tab"
              onClick={() => void closeTab(t.id)}
            >
              ×
            </button>
          </span>
        ))}
        <button type="button" className="baud-browser-tab" title="open a tab" onClick={() => void openTab()}>
          +
        </button>
      </div>
      <div className="baud-browser-bar">
        <button type="button" className="baud-browser-step" aria-label="back" title="back" onClick={() => step(-1)}>
          ‹
        </button>
        <button type="button" className="baud-browser-step" aria-label="forward" title="forward" onClick={() => step(1)}>
          ›
        </button>
        <input
          ref={address}
          className="baud-browser-address"
          aria-label="address"
          spellCheck={false}
          value={draft ?? current?.url ?? ""}
          onFocus={(e) => setDraft(e.target.value)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
            if (e.key === "Escape") setDraft(null);
          }}
        />
      </div>
      {targets.length === 0 ? <p className="baud-browser-line">no pages open</p> : null}
      {hidden ? <p className="baud-browser-line">Chrome's window is hidden; frames stop until it is shown</p> : null}
      {said ? <p className="baud-browser-said">{said}</p> : null}
      <div className="baud-browser-stage">
        <canvas
          ref={canvas}
          className={`baud-browser-canvas ${hidden ? "baud-browser-canvas-hidden" : ""}`}
          tabIndex={0}
          aria-label={current ? `page: ${current.title || current.url}` : "page"}
          onMouseDown={mouse("mousePressed")}
          onMouseUp={mouse("mouseReleased")}
          onMouseMove={mouse("mouseMoved")}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={key("down")}
          onKeyUp={key("up")}
        />
      </div>
    </div>
  );
}
