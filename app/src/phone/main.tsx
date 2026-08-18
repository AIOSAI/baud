/**
 * The phone face's entry point (FPLAN-0413 phases 2-4).
 *
 * A second vite entry, not a second app: it mounts the same components against
 * the HTTP transport. The desktop's `main.tsx` is untouched and stays bound to
 * tauri - which is the property that makes this safe to ship half-built.
 *
 * The token gate lives here rather than inside the shell so that the shell can
 * assume it is connected. One place decides "are we in", everything below it
 * gets to be simple.
 */

import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

import PhoneApp from "./PhoneApp";
import TokenDoor from "./TokenDoor";
import { readToken, verifyToken, writeToken } from "../host/transport.http";
// Tokens first - the phone is coloured by the same custom properties as the
// desktop, which is why it looks like BAUD without one line of new palette.
import "../tokens/tokens.generated.css";
import "../theme.css";
import "./phone.css";

function Face() {
  // A token in storage means "connected" optimistically; the first poll
  // proves it, and a 401 sends us straight back to the door.
  const [connected, setConnected] = useState(() => readToken() !== null);
  const [label, setLabel] = useState("");
  // The token's scope decides whether verbs fire or explain themselves. It is
  // the SERVER's answer from /v1/whoami, never a guess from the client - and
  // "read" until proven otherwise, so a face that failed to ask stays safe.
  const [scope, setScope] = useState<string>("read");
  /**
   * HAS THE SERVER ANSWERED YET - a different question from `scope`, and the
   * startup agent is what proved they are different (DPLAN-0302).
   *
   * `scope` above is "read" in three unrelated situations: a genuinely
   * read-scoped token, an answer that failed, and THE FIRST FRAME OF EVERY
   * RETURNING ARRIVAL, before whoami has been asked. Everything downstream is
   * happy with that conflation, because for a verb chip all three mean the same
   * safe thing - refuse and say why. The startup seat is the one consumer that
   * has to tell them apart: it takes its ONE look and is done, so reading a
   * not-yet-answered "read" would spend the shot on a question nobody asked.
   *
   * It is not a theoretical race and it does not merely happen sometimes - it
   * happens EVERY TIME. Child effects run before the parent's, so PhoneApp asks
   * for the settings and the fleet before this effect asks whoami; and
   * `/v1/fleet` is an `async def` that shells out to `baud --snapshot` without
   * awaiting (server.py:661-668), so it holds the event loop for the whole read
   * and whoami cannot be answered until it lets go. The fleet ALWAYS lands
   * first. Gating the seat on `scope` alone would have made Patrick's own case -
   * refresh, operate token, devpulse named - refuse itself on every load, and
   * the round would have shipped looking correct.
   */
  const [scopeKnown, setScopeKnown] = useState(false);

  /**
   * The RETURNING operator, which is the normal case - the token persists, so
   * most arrivals skip the door entirely and land straight on the fleet. They
   * never pass through `onOpen`, so without this the scope would sit at its
   * safe default and an operate token would show every verb refused, on a face
   * that had never once asked the server what it was holding. Ask on mount.
   */
  useEffect(() => {
    const stored = readToken();
    if (!stored) return;
    void verifyToken(stored)
      .then((who) => {
        setLabel(who.label ?? "");
        setScope(who.scope ?? "read");
      })
      // A failure here is NOT a sign-out: the fleet poll is the thing that
      // knows the difference between "token refused" and "nothing answered",
      // and it already sends a 401 back to the door. Staying read-scoped is the
      // safe end of a question we could not get an answer to.
      .catch(() => setScope("read"))
      // ANSWERED, either way. A refusal we settled on is still a settled
      // question - "read, because we could not get an answer" is exactly what
      // the line above decided, and the seat is entitled to act on it. What it
      // must never act on is silence, which is why this rides the outcome
      // rather than the call.
      .finally(() => setScopeKnown(true));
  }, [connected]);

  if (!connected) {
    return (
      <TokenDoor
        onOpen={(who, granted) => {
          setLabel(who);
          setScope(granted);
          // The door got here by asking whoami itself, so this arrival knows
          // its scope before the fleet has been read once.
          setScopeKnown(true);
          setConnected(true);
        }}
      />
    );
  }

  return (
    <PhoneApp
      label={label}
      scope={scope}
      scopeKnown={scopeKnown}
      onSignOut={() => {
        writeToken(null);
        setConnected(false);
      }}
    />
  );
}

const container = document.getElementById("root");

if (container) {
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <Face />
    </React.StrictMode>,
  );
}
