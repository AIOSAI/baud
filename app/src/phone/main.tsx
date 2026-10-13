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
import { type Arrival, PAIR_EXPIRED, addressWithoutFragment, arrive, isPairLink, pairCodeFrom } from "./lib/pairing";
import { readToken, redeemPairing, verifyToken, writeToken } from "../host/transport.http";
// Tokens first - the phone is coloured by the same custom properties as the
// desktop, which is why it looks like BAUD without one line of new palette.
import "../tokens/tokens.generated.css";
import "../theme.css";
import "./phone.css";

/**
 * THE PAIR LINK, read once, before the first paint (DPLAN-0406). The machine's
 * QR opens `/#pair=<code>`; the code leaves the address bar and the history row
 * here, before React mounts, so no screen, reload or back button shows it again.
 */
function takePairCode(): string | null {
  const { hash, pathname, search } = window.location;
  if (!isPairLink(hash)) return null;
  window.history.replaceState(null, "", addressWithoutFragment(pathname, search));
  return pairCodeFrom(hash);
}

/**
 * The redeem, started at module load and never again. A code is ONE USE, and
 * StrictMode runs every effect twice in development: a redeem inside an effect
 * would spend the code on the first run and show "expired" on the second.
 * One promise, made here, that the effect below only listens to.
 */
const PAIR_CODE = takePairCode();
const PAIRING: Promise<Arrival> | null = PAIR_CODE
  ? arrive(PAIR_CODE, { readToken, writeToken, verifyToken, redeemPairing })
  : null;

function Face() {
  // A token in storage means "connected" optimistically; the first poll
  // proves it, and a 401 sends us straight back to the door. A pair link in
  // flight decides first: until it answers, no poll may run on a token it is
  // about to replace.
  const [connected, setConnected] = useState(() => PAIRING === null && readToken() !== null);
  const [pairing, setPairing] = useState(PAIRING !== null);
  /** How a pair link ended when it did not open the face; the door says it. */
  const [arrival, setArrival] = useState<Arrival | null>(null);
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
    // Not while the door is up: a pair link in flight owns the token store
    // until it answers, and a signed-out face has nothing to ask about.
    if (!stored || !connected) return;
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

  /**
   * The pair link's answer. Opened means the face signs itself in exactly as a
   * door that proved a paste does; anything else is carried to the door.
   */
  useEffect(() => {
    if (!PAIRING) return;
    let live = true;
    void PAIRING.then((ended) => {
      if (!live) return;
      if (ended.kind === "open") {
        setLabel(ended.who.label);
        setScope(ended.who.scope);
        setScopeKnown(true);
        setConnected(true);
      } else {
        setArrival(ended);
      }
      setPairing(false);
    });
    return () => {
      live = false;
    };
  }, []);

  if (pairing) {
    return (
      <main className="baud-phone-door">
        <h1 className="baud-phone-door-title">BAUD</h1>
        <p className="baud-phone-door-line">pairing this phone…</p>
      </main>
    );
  }

  if (!connected) {
    return (
      <TokenDoor
        pairNotice={
          arrival?.kind === "expired"
            ? PAIR_EXPIRED
            : arrival?.kind === "refused"
              ? `the server refused the pairing — ${arrival.message}`
              : null
        }
        arrivedUnreachable={arrival?.kind === "unreachable" ? arrival.message : null}
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
        // A sign-out is a fresh door: the pair link's old answer is not news.
        setArrival(null);
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
