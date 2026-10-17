/**
 * The verb chips, and the confirmation before the destructive ones.
 * Refused chips stay visible with their reason. The confirm is client manners, not a lock: the server is never told a human confirmed.
 */

import { useState } from "react";

import { HostError } from "../host/transport.http";
import type { BranchStatus, VerbResult } from "../types";
import { lockFace, lockLine, useLockState } from "./lib/lock";
import { LOCK_VERB, PHONE_VERBS, type PhoneVerb, type Scope, screenIsAwake, scopeRefusal } from "./lib/verbs";

// The phone is served over plain http on a tailnet address, which is not a secure context.
function hasSecureContext(): boolean {
  return typeof window !== "undefined" && window.isSecureContext === true;
}

const TAP_CONFIRMS = "on this connection your tap is the confirmation — no fingerprint is asked";
const VERIFIED = "verified by this device";

/** Fingerprint/face via WebAuthn where offered, else an explicit tap; returns which, so the UI can say so. */
async function verifyPerson(): Promise<"platform" | "tap"> {
  if (!hasSecureContext()) return "tap";
  const available =
    typeof window.PublicKeyCredential !== "undefined" &&
    (await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false));

  if (!available) return "tap";

  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        userVerification: "required",
        timeout: 60_000,
      },
    });
    return "platform";
  } catch {
    // No credential, or declined: the tap already made stands. This was never the lock.
    return "tap";
  }
}

interface VerbChipsProps {
  branch: BranchStatus;
  scope: Scope;
  /**
   * Fired only when `end room` came back ok, so the room's tab drops its client.
   * @api attaches with `new-session -A`: a reconnect into an ended room would recreate it.
   */
  onEnded?: () => void;
}

export default function VerbChips({ branch, scope, onEnded }: VerbChipsProps) {
  const [pending, setPending] = useState<PhoneVerb | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const refusal = scopeRefusal(scope);

  async function fire(verb: PhoneVerb, verified = false) {
    setBusy(verb.id);
    setSaid(null);
    const tell = (line: string) => setSaid(verified ? `${VERIFIED} · ${line}` : line);
    try {
      const result: VerbResult = await verb.run(branch);
      tell(result.ok ? (result.detail ?? `${verb.label} done`) : (result.detail ?? `${verb.label} refused`));
      // On the machine's answer only: a refused kill leaves the room alive.
      if (result.ok && verb.id === "kill") onEnded?.();
    } catch (cause) {
      tell(cause instanceof HostError ? cause.message : String(cause));
    } finally {
      setBusy(null);
      setPending(null);
    }
  }

  async function press(verb: PhoneVerb) {
    if (!verb.destructive) return fire(verb);

    if (!screenIsAwake()) {
      setSaid("refused: this screen is not awake — destructive verbs never fire from a lock screen");
      return;
    }
    setPending(verb);
  }

  async function confirm(verb: PhoneVerb) {
    if (!screenIsAwake()) {
      setSaid("refused: the screen slept while confirming");
      setPending(null);
      return;
    }
    const how = await verifyPerson();
    await fire(verb, how === "platform");
  }

  return (
    <>
      <nav className="baud-phone-verbs">
        {PHONE_VERBS.map((verb) => {
          const availability = verb.availability(branch);
          const why = refusal ?? (availability.ready ? null : availability.reason);
          return (
            <button
              key={verb.id}
              type="button"
              className={`baud-phone-verb ${verb.destructive ? "baud-phone-verb-destructive" : ""} ${
                why ? "baud-phone-verb-refused" : ""
              }`}
              /* Not `disabled`: a disabled button has no title on touch and says nothing when pressed. */
              title={why ?? verb.title(branch)}
              onClick={() => (why ? setSaid(`refused: ${why}`) : void press(verb))}
            >
              {busy === verb.id ? "…" : verb.label}
            </button>
          );
        })}
      </nav>

      {said ? <p className="baud-phone-said">{said}</p> : null}

      {pending ? (
        <div className="baud-phone-confirm" role="dialog" aria-label={`confirm ${pending.label}`}>
          <p className="baud-phone-confirm-line">{pending.title(branch)}</p>
          <p className="baud-phone-confirm-warn">this cannot be undone — the scrollback goes with it</p>
          {hasSecureContext() ? null : <p className="baud-phone-confirm-note">{TAP_CONFIRMS}</p>}
          <div className="baud-phone-confirm-row">
            <button type="button" className="baud-phone-confirm-no" onClick={() => setPending(null)}>
              cancel
            </button>
            <button
              type="button"
              className="baud-phone-confirm-yes"
              onClick={() => void confirm(pending)}
            >
              end it
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * The machine-wide lock chip, once in the header; it also reads the lock's position, under read scope too.
 * Locked is amber, not red (red means dead or refused); unknown is never drawn as unlocked.
 */
export function LockChip({ scope }: { scope: Scope }) {
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = scopeRefusal(scope);
  const { read, reread } = useLockState();
  const face = lockFace(read);
  const title = [lockLine(read), said ?? refusal ?? LOCK_VERB.title].filter(Boolean).join(" — ");

  async function press() {
    if (refusal) {
      setSaid(`refused: ${refusal}`);
      return;
    }
    setBusy(true);
    try {
      const result = await LOCK_VERB.run();
      setSaid(result.ok ? (result.detail ?? "locked") : (result.detail ?? "refused"));
    } catch (cause) {
      setSaid(cause instanceof HostError ? cause.message : String(cause));
    } finally {
      setBusy(false);
      // Read the position back rather than assume the tap worked; the lock lands async.
      reread();
    }
  }

  /* `said` shows under the chip: a touch screen never shows the title. Off the header row, which is tuned to one slim line. */
  return (
    <span className="baud-phone-lockwrap">
      <button
        type="button"
        className={`baud-phone-lock ${refusal ? "baud-phone-verb-refused" : ""} ${
          face === "unread" ? "" : `baud-phone-lock-${face}`
        }`}
        title={title}
        onClick={() => void press()}
      >
        {busy ? (
          "…"
        ) : (
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
            <rect x="3" y="11" width="18" height="11" rx="2" />
            {face === "unlocked" ? <path d="M7 11V7a5 5 0 0 1 9.9-1" /> : <path d="M7 11V7a5 5 0 0 1 10 0v4" />}
          </svg>
        )}
      </button>
      {said ? (
        <button type="button" className="baud-phone-said baud-phone-locksaid" onClick={() => setSaid(null)}>
          {said}
        </button>
      ) : null}
    </span>
  );
}
