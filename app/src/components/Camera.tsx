import { useState } from "react";
import { screenshotCapture } from "../host";

/**
 * The camera button (m8): one click opens the compositor's own screenshot
 * picker (region / window / full screen - the portal's interactive mode),
 * and the saved capture's PATH is handed to the chat box. Claude Code reads
 * images by path, so delivering the path IS delivering the screenshot - the
 * operator just presses Enter.
 *
 * The capture is slow by design (the operator is inside the picker), so the
 * button goes quiet while a request is out rather than stacking portals.
 */

interface CameraProps {
  /** Deliver the saved capture's path toward the chat box. */
  onCaptured: (path: string) => void;
}

export default function Camera({ onCaptured }: CameraProps) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const capture = () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    screenshotCapture()
      .then((path) => onCaptured(path))
      .catch((err) => {
        // A cancelled picker lands here too - worth showing, never worth
        // an alarm. The title carries it until the next attempt.
        setFailure(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setBusy(false));
  };

  return (
    <button
      type="button"
      className={`baud-tool-btn ${busy ? "baud-tool-btn-busy" : ""} ${failure ? "baud-tool-btn-failed" : ""}`}
      title={
        busy
          ? "capturing - the system picker is open"
          : (failure ?? "screenshot: system picker opens, the path lands in your chat box")
      }
      onClick={capture}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    </button>
  );
}
