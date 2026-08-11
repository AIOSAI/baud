import { useCallback, useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * Whole-window zoom: browser-style ctrl +/- for a webview that ships
 * with none. The webview's zoom factor scales everything — cards, tabs and
 * the terminal together (xterm's DOM renderer re-fits through the normal
 * ResizeObserver path, so the shell learns its new column count for free).
 *
 * React state is the single source of truth: every change goes through
 * setZoom(), so the chip's percentage can never drift from what the window
 * actually shows. The level survives restarts via localStorage.
 */

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const STEP = 0.1;
const STORE_KEY = "baud-zoom";

/** One-decimal steps: 0.1 + 0.2 style float dust never reaches the label. */
function clamp(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 10) / 10));
}

function storedZoom(): number {
  const raw = Number(window.localStorage.getItem(STORE_KEY));
  return Number.isFinite(raw) && raw > 0 ? clamp(raw) : 1;
}

export default function Zoom() {
  const [zoom, setZoom] = useState(storedZoom);
  const [failure, setFailure] = useState<string | null>(null);

  const apply = useCallback((next: (current: number) => number) => {
    setZoom((current) => clamp(next(current)));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORE_KEY, String(zoom));
    getCurrentWebview()
      .setZoom(zoom)
      .then(() => setFailure(null))
      .catch((err) => {
        setFailure(err instanceof Error ? err.message : String(err));
      });
  }, [zoom]);

  // Ctrl+= / Ctrl+- / Ctrl+0 and ctrl+scroll, captured at the window BEFORE
  // the terminal's textarea can see them - zoom keys belong to the app, not
  // the shell, exactly like a browser. Plain keystrokes pass through
  // untouched.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey) return;
      if (event.key === "=" || event.key === "+") apply((z) => z + STEP);
      else if (event.key === "-" || event.key === "_") apply((z) => z - STEP);
      else if (event.key === "0") apply(() => 1);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      apply((z) => z + (event.deltaY < 0 ? STEP : -STEP));
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("wheel", onWheel, true);
    };
  }, [apply]);

  return (
    <span className="baud-zoom">
      <button
        type="button"
        className="baud-zoom-btn"
        title="zoom out (ctrl -)"
        onClick={() => apply((z) => z - STEP)}
      >
        −
      </button>
      <button
        type="button"
        className={`baud-zoom-level ${failure ? "baud-zoom-failed" : ""}`}
        title={failure ?? "reset to 100% (ctrl 0) · ctrl+scroll zooms too"}
        onClick={() => apply(() => 1)}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        className="baud-zoom-btn"
        title="zoom in (ctrl +)"
        onClick={() => apply((z) => z + STEP)}
      >
        +
      </button>
    </span>
  );
}
