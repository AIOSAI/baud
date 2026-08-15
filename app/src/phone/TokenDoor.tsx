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
 */

import { useState } from "react";

import { HostError, verifyToken, writeToken } from "../host/transport.http";

interface TokenDoorProps {
  /** A token proved good - the shell may open, with the scope the server granted. */
  onOpen: (label: string, scope: string) => void;
}

export default function TokenDoor({ onOpen }: TokenDoorProps) {
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState<string | null>(null);

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
      <p className="baud-phone-door-line">the fleet, in your pocket — read-only</p>

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
