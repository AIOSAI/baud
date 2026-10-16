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
import { lockFace, lockLine, useLockState } from "./lib/lock";
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
  /**
   * The room this branch had is GONE - fired only when `end room` came back ok.
   *
   * WHY THIS EXISTS (FPLAN-0446 r5): the doctrine sentence in `PhoneApp` has
   * always said a room drops its client on three gestures, one of which is end
   * room - but nothing was wired to it, so a killed room left its tab sitting
   * on a frame of a session that no longer existed. That was survivable while
   * a detached sheet just sat there. It stopped being survivable the moment
   * the sheet learned to reconnect by itself: @api attaches with `new-session
   * -A`, which is attach-or-CREATE, so a retry into an ended room does not
   * fail - it builds a new empty one wearing the dead room's name, and the
   * phone would be quietly undoing the operator's own gesture.
   */
  onEnded?: () => void;
}

export default function VerbChips({ branch, scope, onEnded }: VerbChipsProps) {
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
      // ON THE MACHINE'S ANSWER, never on the request leaving - same rule the
      // sentence above follows. A kill that was refused leaves the room alive,
      // and closing its pane would be this face inventing an outcome.
      if (result.ok && verb.id === "kill") onEnded?.();
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
 *
 * IT READS THE LOCK TOO (FPLAN-0585 row 3; Patrick, 2026-09-13: away from home,
 * a glance answers "did I lock the laptop?"). Four faces, from `lib/lock.ts`:
 * - UNLOCKED: the OPEN shackle, green - open is live.
 * - LOCKED: the closed shackle, amber - attention, not failure. Red on this face
 *   means dead or refused, and a locked laptop is neither.
 * - UNKNOWN: the closed shackle, dim, DASHED border - the wheel's dead-ring idiom.
 *   The machine could not tell, or the read failed, and the title says which.
 *   Never drawn as unlocked.
 * - UNREAD, before the first answer: exactly the chip this was before it could
 *   read anything.
 * The READ rides the read scope, so a read-scoped token sees the lock's position
 * even though its tap is refused - the title still says so.
 */
export function LockChip({ scope }: { scope: Scope }) {
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refusal = scopeRefusal(scope);
  const { read, reread } = useLockState();
  const face = lockFace(read);
  /** The reading's own sentence first, then what the tap last heard (or why a
   *  tap would be refused). Before any reading, exactly the old title. */
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
      // Read the lock's position back rather than assume the tap worked: at
      // once, and again a second later, because the lock lands async.
      reread();
    }
  }

  /* WHAT THE TAP HEARD, SAID ON THE FACE (DPLAN-0414 A#13 = B#11). Under a
     read token the tap used to do nothing visible, and under operate the
     host's answer showed only as the chip's colour change - both sentences
     lived in the title, which a touch screen never shows. So `said` (the
     machine's answer, or the refusal) drops under the chip in the verb chips'
     answer voice, the way their result line prints. It hangs off the chip
     rather than sitting in the header row, because that row was tuned to one
     slim line and a sentence in it would move every control beside it. A tap
     on the line puts it away; the next press replaces it. The title stays. */
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
            {/* OPEN: the shackle's right leg lifts clear of the body. Every other
                face - locked, unknown, unread - is the closed shackle. */}
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
