import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import FleetStrip from "./components/FleetStrip";
import Terminal from "./components/Terminal";
import { relativeAge } from "./age";
import type { FleetSnapshot } from "./types";

const POLL_INTERVAL_MS = 5000;

export default function App() {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);

  const poll = useCallback(async (alive: () => boolean) => {
    try {
      const next = await invoke<FleetSnapshot>("fleet_snapshot");
      if (!alive()) return;
      setSnapshot(next);
      setTransportError(null);
    } catch (err) {
      if (!alive()) return;
      setTransportError(
        err instanceof Error ? err.message : `fleet_snapshot failed: ${String(err)}`,
      );
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const alive = () => mounted;

    void poll(alive);
    const timer = window.setInterval(() => void poll(alive), POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [poll]);

  const branches = snapshot?.branches ?? [];
  const citizens = branches.filter((branch) => branch.is_citizen).length;
  const working = branches.filter((branch) => branch.working).length;
  const unread = branches.reduce((total, branch) => total + branch.new_mail, 0);
  const plans = branches.reduce((total, branch) => total + branch.active_plans, 0);

  // Root resolution failure comes back inside the payload; a broken IPC call
  // comes back as a thrown error. Both are shown, never swallowed.
  const failure = transportError ?? snapshot?.error ?? null;

  const pollStatus = transportError
    ? "poll failing"
    : snapshot
      ? `polled ${relativeAge(snapshot.generated_at).label} · every ${POLL_INTERVAL_MS / 1000}s`
      : "waiting for the first snapshot…";

  return (
    <div className="baud-app">
      <header className="baud-header">
        <span className="baud-wordmark">BAUD</span>

        <div className="baud-totals">
          <Total label="citizens" value={citizens} />
          <Total label="working" value={working} tone="live" />
          <Total label="unread mail" value={unread} tone={unread > 0 ? "alert" : undefined} />
          <Total label="plans" value={plans} />
        </div>
      </header>

      {failure ? (
        <div className="baud-failure" role="alert">
          <span className="baud-failure-tag">FAULT</span>
          <span className="baud-failure-text">{failure}</span>
        </div>
      ) : null}

      {snapshot === null && !failure ? (
        <div className="baud-strip baud-strip-empty">
          <p className="baud-empty">Waiting for the first snapshot…</p>
        </div>
      ) : (
        <FleetStrip branches={branches} />
      )}

      <main className="baud-stage">
        <Terminal />
      </main>

      <footer className="baud-footer">
        <span className="baud-footer-root" title={snapshot?.aipass_root ?? ""}>
          {snapshot?.aipass_root || "resolving AIPass root…"}
        </span>
        <span className={`baud-footer-poll ${transportError ? "baud-footer-poll-alert" : ""}`}>
          {pollStatus}
        </span>
      </footer>
    </div>
  );
}

function Total({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "live" | "alert";
}) {
  const toneClass = tone ? ` baud-total-${tone}` : "";
  return (
    <div className={`baud-total${toneClass}`}>
      <span className="baud-total-value">{value}</span>
      <span className="baud-total-label">{label}</span>
    </div>
  );
}
