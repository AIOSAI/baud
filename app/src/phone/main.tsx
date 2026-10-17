/** The phone face's entry: a second vite entry mounting the same components on the HTTP transport, behind the door. */

import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

import PhoneApp from "./PhoneApp";
import TokenDoor from "./TokenDoor";
import { type Arrival, PAIR_EXPIRED, addressWithoutFragment, arrive, isPairLink, pairCodeFrom } from "./lib/pairing";
import { readToken, redeemPairing, verifyToken, writeToken } from "../host/transport.http";
import "../tokens/tokens.generated.css";
import "../theme.css";
import "./phone.css";

/** The only `replaceState`: `#pair=` leaves before React mounts, and systemBack's URL-less guard inherits it. */
function takePairCode(): string | null {
  const { hash, pathname, search } = window.location;
  if (!isPairLink(hash)) return null;
  window.history.replaceState(null, "", addressWithoutFragment(pathname, search));
  return pairCodeFrom(hash);
}

/** Redeemed at module load: a code is one use, and StrictMode's double effect would spend it, then show "expired". */
const PAIR_CODE = takePairCode();
const PAIRING: Promise<Arrival> | null = PAIR_CODE
  ? arrive(PAIR_CODE, { readToken, writeToken, verifyToken, redeemPairing })
  : null;

/** Keeps `__BAUD_TREE__` in the bundle for the deploy check's grep: with no reader, vite's define drops it. */
declare const __BAUD_TREE__: string | undefined;
if (typeof __BAUD_TREE__ === "string") document.documentElement.dataset.baudTree = __BAUD_TREE__;

function Face() {
  // A stored token is connected until a 401; a pair link in flight decides first, as it may replace the token.
  const [connected, setConnected] = useState(() => PAIRING === null && readToken() !== null);
  const [pairing, setPairing] = useState(PAIRING !== null);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [label, setLabel] = useState("");
  // The server's whoami answer, never a client guess; "read" until proven, so a face that failed to ask stays safe.
  const [scope, setScope] = useState<string>("read");
  /** Whether whoami has answered: `scope` is "read" on every first frame and the fleet read always lands first
   *  (it holds the server's event loop), so the startup seat would spend its one look on an unasked question. */
  const [scopeKnown, setScopeKnown] = useState(false);

  /** A returning operator skips the door and `onOpen`, so whoami is asked on mount. */
  useEffect(() => {
    const stored = readToken();
    if (!stored || !connected) return;
    void verifyToken(stored)
      .then((who) => {
        setLabel(who.label ?? "");
        setScope(who.scope ?? "read");
      })
      // Not a sign-out: the fleet poll tells refused from unanswered, and it already sends a 401 to the door.
      .catch(() => setScope("read"))
      // Answered either way: the seat may act on a settled "read", never on silence.
      .finally(() => setScopeKnown(true));
  }, [connected]);

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
