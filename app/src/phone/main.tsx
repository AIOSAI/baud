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
      .catch(() => setScope("read"));
  }, [connected]);

  if (!connected) {
    return (
      <TokenDoor
        onOpen={(who, granted) => {
          setLabel(who);
          setScope(granted);
          setConnected(true);
        }}
      />
    );
  }

  return (
    <PhoneApp
      label={label}
      scope={scope}
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
