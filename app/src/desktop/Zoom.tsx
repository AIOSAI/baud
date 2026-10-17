import { useCallback, useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * Whole-window zoom (ctrl +/-, ctrl+scroll) for a webview that ships with none.
 * Every change goes through React state, so the chip's percentage never drifts from the window.
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

  // Capture phase: zoom keys must reach the app before the terminal's textarea takes them.
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
