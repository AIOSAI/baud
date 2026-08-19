/**
 * The verb chips, and the asking that comes before the destructive ones
 * (FPLAN-0413 phase 6).
 *
 * REFUSED IS A STATE, NOT AN ABSENCE. Under a read-scoped token every chip is
 * still here, greyed, carrying the sentence that says why it will not fire.
 * Hiding them would make a designed absence look exactly like a broken build,
 * and the whole face has been built the other way round since phase 1.
 *
 * CONFIRMATION IS THE CLIENT'S MANNERS, NOT THE SERVER'S LOCK. The dialog below
 * cannot stop anyone who has the token - they can curl the endpoint. What it
 * stops is the pocket tap and the mis-aimed thumb, which are the failures a
 * phone actually has. The server is never told that a human confirmed, because
 * a claim like that from a client is worth nothing.
 */

import { useState } from "react";

import { HostError } from "../host/transport.http";
import type { BranchStatus, VerbResult } from "../types";
import { LOCK_VERB, PHONE_VERBS, type PhoneVerb, type Scope, screenIsAwake, scopeRefusal } from "./lib/verbs";

/**
 * Ask the platform to verify the person, where the platform offers it.
 *
 * On a phone this is the fingerprint or face prompt, reached through WebAuthn -
 * the only door a browser gives to that hardware. Where it is unavailable
 * (a desktop browser, no enrolled credential, an insecure origin) the answer is
 * an explicit tap instead, and the caller is told which it got so the UI can be
 * honest about what actually happened.
 */
async function verifyPerson(): Promise<"platform" | "tap"> {
  const available =
    typeof window !== "undefined" &&
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
    // No enrolled credential, or the person declined. Either way the explicit
    // tap they already made is what we fall back to - this was never the lock.
    return "tap";
  }
}

interface VerbChipsProps {
  branch: BranchStatus;
  scope: Scope;
}

export default function VerbChips({ branch, scope }: VerbChipsProps) {
  const [pending, setPending] = useState<PhoneVerb | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const refusal = scopeRefusal(scope);

  async function fire(verb: PhoneVerb) {
    setBusy(verb.id);
    setSaid(null);
    try {
      const result: VerbResult = await verb.run(branch);
      // The chip reports what the MACHINE said, never that the request left.
      setSaid(result.ok ? (result.detail ?? `${verb.label} done`) : (result.detail ?? `${verb.label} refused`));
    } catch (cause) {
      setSaid(cause instanceof HostError ? cause.message : String(cause));
    } finally {
      setBusy(null);
      setPending(null);
    }
  }

  async function press(verb: PhoneVerb) {
    if (!verb.destructive) return fire(verb);

    // Guard 2, checked at the moment of pressing rather than assumed.
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
    // Named out loud: an operator should know whether their fingerprint was
    // actually asked for, or whether a tap was all that stood there.
    setSaid(how === "platform" ? "verified by this device" : null);
    await fire(verb);
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
              /* Not `disabled`: a disabled button has no title on touch and
                 says nothing when pressed. Refused chips stay pressable and
                 answer with their reason - the refusal IS the feedback. */
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
 * The machine-wide lock, rendered once in the header rather than per card.
 *
 * Not destructive - a locked screen unlocks - so it does not ask first. It does
 * still respect scope, and it says what the machine said.
 */
export function LockChip({ scope }: { scope: Scope }) {
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = scopeRefusal(scope);

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
    }
  }

  return (
    <button
      type="button"
      className={`baud-phone-lock ${refusal ? "baud-phone-verb-refused" : ""}`}
      title={said ?? refusal ?? LOCK_VERB.title}
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
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      )}
    </button>
  );
}
