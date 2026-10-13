/**
 * The token door - the only credential surface the phone face has
 * (FPLAN-0413 phase 2).
 *
 * NO TOKEN IS EVER BAKED INTO THE BUNDLE. The bundle is a static asset that
 * anybody who reaches the server can fetch; a token compiled into it would be
 * a credential published to whoever asks. So the face opens empty and the
 * operator pastes one, minted by @api's `issue-token`.
 *
 * The paste is proved against `/v1/whoami` BEFORE it is trusted, because a
 * token that merely looks well-formed is not a token the server accepts. And
 * the two ways that probe can fail are kept apart on purpose:
 *
 *   rejected     - the server answered, and said no. Paste a different one.
 *   unreachable  - nothing answered. The token may be perfect; go look at the
 *                  server, the bind, or the network.
 *
 * Collapsing those into "login failed" would send the operator to re-mint a
 * token that was never the problem.
 *
 * THE PAIR DOOR ARRIVES HERE TOO (DPLAN-0406). A phone that scanned the
 * machine's QR is signed in by main.tsx before this door is drawn; it only
 * lands here when the pairing did not work, and then it brings what happened:
 * `pairNotice` (the server refused the code) sits above the paste field, and
 * `arrivedUnreachable` opens the door already showing the unreachable line.
 * The two stay apart for the same reason as above. The paste field stays in
 * every case: it is the fallback, never removed.
 */

import { useState } from "react";

import { HostError, verifyToken, writeToken } from "../host/transport.http";

interface TokenDoorProps {
  /** A token proved good - the shell may open, with the scope the server granted. */
  onOpen: (label: string, scope: string) => void;
  /** Why a pair link did not sign this phone in, when the server refused it. */
  pairNotice?: string | null;
  /** The unreachable line a pair link's arrival already met. */
  arrivedUnreachable?: string | null;
}

export default function TokenDoor({ onOpen, pairNotice = null, arrivedUnreachable = null }: TokenDoorProps) {
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState<string | null>(arrivedUnreachable);

  async function connect() {
    const raw = token.trim();
    if (!raw || checking) return;
    setChecking(true);
    setRejected(null);
    setUnreachable(null);
    try {
      const who = await verifyToken(raw);
      writeToken(raw);
      onOpen(who.label ?? "", who.scope ?? "read");
    } catch (error) {
      // The distinction the whole screen exists to preserve.
      if (error instanceof HostError && error.code === "unreachable") {
        setUnreachable(error.message);
      } else if (error instanceof HostError) {
        setRejected(error.message);
      } else {
        setRejected(String(error));
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="baud-phone-door">
      <h1 className="baud-phone-door-title">BAUD</h1>
      {/* THE SAME STALENESS THE MANIFEST CARRIED, in the one place it is read
          before anything else. "read-only" was true of the whole face when this
          line was written; tonight it is a property of the TOKEN - a read token
          still refuses every verb by name, an operate token opens the fleet -
          and this door is shown before either is known. So it says what is true
          of both, and the scope chip in the header says which one arrived. */}
      <p className="baud-phone-door-line">the fleet, in your pocket</p>

      {/* The server answered the pair link and said no: its kind of failure is
          a refusal, so it wears the refusal's colour, above the field it
          sends the operator to. */}
      {pairNotice ? <p className="baud-phone-door-rejected">{pairNotice}</p> : null}

      <label className="baud-phone-door-label" htmlFor="baud-token">
        access token
      </label>
      <input
        id="baud-token"
        className="baud-phone-door-input"
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="paste the token @api minted"
        value={token}
        onChange={(event) => setToken(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void connect();
        }}
      />

      <button
        type="button"
        className="baud-phone-door-button"
        disabled={!token.trim() || checking}
        onClick={() => void connect()}
      >
        {checking ? "checking…" : "connect"}
      </button>

      {rejected ? (
        <p className="baud-phone-door-rejected">
          the server answered and refused this token — {rejected}
        </p>
      ) : null}
      {unreachable ? (
        <p className="baud-phone-door-unreachable">
          could not reach the host API — the token may be fine. {unreachable}
        </p>
      ) : null}

      <p className="baud-phone-door-note">
        Stored on this device only. Sign out clears it.
      </p>
    </main>
  );
}
