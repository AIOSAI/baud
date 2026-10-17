/** The token door, the phone face's only credential surface; no token is ever baked into the public bundle.
 * A paste is proved against `/v1/whoami`; "rejected" stays apart from "unreachable" so a good token is not re-minted. */

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
      {/* Not "read-only": scope belongs to the token, unknown until it is proved. */}
      <p className="baud-phone-door-line">the fleet, in your pocket</p>

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
