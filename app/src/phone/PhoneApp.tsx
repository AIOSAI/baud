/**
 * BAUD in one column - the phone face (FPLAN-0413 phase 3, read depth in 3b).
 *
 * This is the payoff of the transport seam. Every card below is the SAME
 * `BranchChip` the desktop renders, reading the same 18 fields, coloured by
 * the same design tokens. Nothing here reimplements the fleet; it re-seats it.
 * The only thing that changed underneath is which transport `host/index.ts`
 * was built against.
 *
 * READS ARE NOT VERBS - the correction that phase 3b exists for. The first cut
 * wired every card callback to a handler that threw, so the face showed all
 * seventeen agents and did nothing at all (Patrick's review, verbatim: "it
 * shows all agents but zero function"). Opening a file and reading a diff were
 * never verbs; they are exactly what @api's read lane serves. Now the figures
 * on each card open the file they came from, the read row opens the rest, and
 * only the true verbs - launch, shell, settings, end room - stay withdrawn.
 *
 * ALIVENESS COMES FROM ONE FIELD. The lamp is driven by the card's own
 * `dispatched`/`interactive`, exactly as on the desktop, and the session list
 * is shown as its own line rather than joined into the cards. `has_room` means
 * a room EXISTS, not that anyone is in it - deriving a green light from it
 * would ship the lie the m12 badge work existed to kill.
 */

import { useCallback, useEffect, useState } from "react";

import BranchChip from "../components/BranchChip";
import { fleetSnapshot } from "../host";
import { HostError, writeToken } from "../host/transport.http";
import type { BranchStatus, FleetSnapshot } from "../types";
import FeedScreen from "./FeedScreen";
import Reader, { type ReadTarget } from "./Reader";
import TerminalSheet from "./TerminalSheet";
import VerbChips, { LockChip } from "./VerbChips";
import { type LaunchMode, roomDoors } from "./rooms";
import { PHONE_VERBS, type Scope, scopeRefusal } from "./verbs";

/** The desktop's own middle cadence. A phone on cellular does not want 2s. */
const POLL_MS = 10_000;

/**
 * The files every citizen has, by the names the fence takes.
 *
 * The desktop card's figures already open the first three - these are the same
 * documents reached from a row instead of a number, because a thumb wants a
 * word to press and the numbers are small.
 */
const READS: ReadonlyArray<{ label: string; file: string }> = [
  { label: "readme", file: "README.md" },
  { label: "memory", file: ".trinity/local.json" },
  { label: "dashboard", file: "DASHBOARD.local.json" },
  { label: "inbox", file: ".ai_mail.local/inbox.json" },
];

interface PhoneAppProps {
  /** The token's own label, from `/v1/whoami` - who this face is connected as. */
  label: string;
  /**
   * What this token may do, from `/v1/whoami`. It does not decide whether the
   * chips EXIST - only whether they fire or answer with their reason.
   */
  scope: Scope;
  /** Operator signed out: forget the token and go back to the door. */
  onSignOut: () => void;
}

export default function PhoneApp({ label, scope, onSignOut }: PhoneAppProps) {
  const [snapshot, setSnapshot] = useState<FleetSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<ReadTarget | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  // Which room the operator is IN, by name, and which door they came through.
  // Held as a NAME rather than a card so the sheet always reads the freshest
  // poll of that branch instead of a snapshot frozen when it opened.
  const [attached, setAttached] = useState<{ name: string; mode: LaunchMode } | null>(null);

  const poll = useCallback(async () => {
    try {
      const next = await fleetSnapshot();
      setSnapshot(next);
      // The envelope carries its own failure. A snapshot that read nothing is
      // not an empty fleet, and the sentence is BAUD's own - show it verbatim.
      setError(next.error ?? null);
    } catch (cause) {
      if (cause instanceof HostError && cause.unauthorized) {
        // The token stopped working while we were using it. Do not sit on a
        // stale fleet pretending it is current.
        writeToken(null);
        onSignOut();
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [onSignOut]);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [poll]);

  const branches = snapshot?.branches ?? [];
  const live = snapshot?.live_agent_sessions ?? [];

  /**
   * The card hands back the absolute path the desktop uses. @api's fence takes
   * NAMES, so the branch's own root is stripped back off here - in the face,
   * which holds the fleet data, rather than in the transport, which does not.
   */
  const openFigure = (path: string, name: string, branchName: string) => {
    const branch = branches.find((candidate) => candidate.name === branchName);
    const relative = branch && path.startsWith(`${branch.path}/`) ? path.slice(branch.path.length + 1) : name;
    setReading({ ref: `${branchName}/${relative}`, title: `${branchName} · ${name}`, kind: "file" });
  };

  if (reading) return <Reader target={reading} onClose={() => setReading(null)} />;
  if (feedOpen) return <FeedScreen pollMs={POLL_MS} onClose={() => setFeedOpen(false)} />;
  const inRoom = attached ? branches.find((card) => card.name === attached.name) : undefined;
  if (inRoom && attached) {
    return (
      <TerminalSheet
        branch={inRoom}
        mode={attached.mode}
        scope={scope}
        onClose={() => setAttached(null)}
      />
    );
  }

  return (
    <div className="baud-phone">
      <header className="baud-phone-head">
        <span className="baud-phone-title">BAUD</span>
        <span className="baud-phone-project">{snapshot?.project ?? "—"}</span>
        <button type="button" className="baud-phone-feedbutton" onClick={() => setFeedOpen(true)}>
          feed
        </button>
        {/* One machine, one lock chip - not one per card. */}
        <LockChip scope={scope} />
        <button type="button" className="baud-phone-signout" onClick={onSignOut} title={`connected as ${label}`}>
          sign out
        </button>
      </header>

      {error ? <p className="baud-phone-error">{error}</p> : null}

      {/* The aliveness line. Its own row precisely BECAUSE it is not a per-card
          fact: these are sessions with an interactive agent actually running,
          decided by the process table on the machine. */}
      <p className="baud-phone-live">
        {live.length ? `live: ${live.join(", ")}` : "no live agent sessions"}
      </p>

      <main className="baud-phone-column">
        {branches.length === 0 && !error ? <p className="baud-phone-empty">reading the fleet…</p> : null}
        {branches.map((branch: BranchStatus) => (
          <article key={`${branch.project}/${branch.name}`} className="baud-phone-card">
            <BranchChip
              branch={branch}
              readOnly
              foreign={false}
              onOpenFile={openFigure}
              /* The DESKTOP's verbs, which the phone does not inherit: each one
                 wants a pty, a file manager or a native window on the machine
                 itself. `readOnly` withdraws every button that would reach
                 them, so they are unreachable by construction - and they throw
                 rather than no-op, because a door that silently does nothing is
                 how a face starts lying about what it can do. The phone's own
                 verbs are the chips below, which go over the wire. */
              onLaunch={verbsAreHeld}
              onFiles={verbsAreHeld}
              onOpenDiff={verbsAreHeld}
              onMonitor={verbsAreHeld}
              onShell={verbsAreHeld}
              onHelp={verbsAreHeld}
              onSettings={verbsAreHeld}
            />
            {/* The read row: the phone's own affordance, not the card's. The
                card stays the report it is on both faces; the doors around it
                belong to whichever face is holding it. */}
            <nav className="baud-phone-reads">
              <button
                type="button"
                onClick={() =>
                  setReading({ ref: branch.name, title: `${branch.name} · diff`, kind: "diff" })
                }
              >
                diff
              </button>
              {READS.map((read) => (
                <button
                  key={read.file}
                  type="button"
                  onClick={() =>
                    setReading({
                      ref: `${branch.name}/${read.file}`,
                      title: `${branch.name} · ${read.label}`,
                      kind: "file",
                    })
                  }
                >
                  {read.label}
                </button>
              ))}
            </nav>
            {/* THE ROOM DOORS - the desktop's own set, on the card where the
                desktop puts them. A live room offers exactly one (attach); a
                cold one offers resume and/or fresh. The judgment is ported in
                `rooms.ts`, not re-derived here, because re-deriving it is how
                the second-claude hazard gets re-earned.

                These moved OUT of the read row when the design changed from
                repaint to attach: watching a picture was a read, but an
                attached room is a shell prompt with the operator's credentials
                at it. Refused with a reason under a read token, never hidden. */}
            <nav className="baud-phone-roomdoors">
              {roomDoors(branch).map((door) => (
                <button
                  key={door.label}
                  type="button"
                  className="baud-phone-roomdoor"
                  disabled={Boolean(scopeRefusal(scope))}
                  title={scopeRefusal(scope) ?? door.title}
                  onClick={() => setAttached({ name: branch.name, mode: door.mode })}
                >
                  {door.label}
                </button>
              ))}
            </nav>
            {/* Verbs sit BELOW the reads and look different, because they are
                different: a read shows you something, a verb changes the
                machine. Under a read token they are still here, refused. */}
            <VerbChips branch={branch} scope={scope} />
          </article>
        ))}
      </main>

      {/* The footer states what this SESSION is, not what the build can do.
          Same bundle, two sentences - the scope is the difference. */}
      <footer className="baud-phone-foot">
        {scopeRefusal(scope)
          ? `read-only mirror · ${PHONE_VERBS.length + 1} verbs present, all refused — ${scope} scope`
          : `operate session · ${PHONE_VERBS.length + 1} verbs live`}
      </footer>
    </div>
  );
}

/** The unreachable branch, kept loud on purpose. */
function verbsAreHeld(): never {
  throw new Error(
    "this is a desktop-only door - it wants a pty or a native window on the machine. " +
      "The phone's verbs are the chips on the card.",
  );
}
