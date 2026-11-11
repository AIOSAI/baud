import { useEffect, useRef, useState } from "react";
import { harkVoice } from "../host";
import type { HarkState } from "../types";
import { harkTitle, harkVerb } from "./harkChip";

/** Hark's mic chip: lit while listening; a click runs `drone @hark voice stop|on`, the next poll confirms. */

const clock = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function Hark({ state }: { state: HarkState }) {
  const [since, setSince] = useState(clock);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const giveUp = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSince(clock());
    setPending(false);
    if (giveUp.current) clearTimeout(giveUp.current);
  }, [state]);

  const verb = harkVerb(state);
  const click = () => {
    if (!verb || pending) return;
    setPending(true);
    setFailure(null);
    // Codex's bare /voice is a toggle: after a dropped voice session the room can land back where it was, so
    // pending must not wait forever for a change that never comes.
    harkVoice(verb)
      .then(() => {
        giveUp.current = setTimeout(() => {
          setPending(false);
          setFailure(`sent voice ${verb}, the room did not change - click again`);
        }, 8000);
      })
      .catch((err) => {
        setPending(false);
        setFailure(err instanceof Error ? err.message : String(err));
      });
  };

  const look = pending
    ? "baud-tool-btn-busy"
    : failure
      ? "baud-tool-btn-failed"
      : state === "listening"
        ? "baud-hark-on"
        : state === "absent"
          ? "baud-hark-absent"
          : "";
  return (
    <button
      type="button"
      className={`baud-tool-btn ${look}`}
      title={pending ? `sent voice ${verb} - waiting for the room to change` : (failure ?? harkTitle(state, since))}
      aria-pressed={state === "listening"}
      onClick={click}
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
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
      </svg>
    </button>
  );
}
