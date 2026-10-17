/**
 * What the copy button needs: the path it hands over, and the lane it hands it
 * over through (FPLAN-0443 rider).
 *
 * WHY THE PATH IS ABSOLUTE AND NOT THE ONE THIS FACE BROWSES WITH. Every path
 * on the phone's fence is a NAME - `<branch>/<relative>`, resolved by the
 * server against a floor the face never learns. That is exactly right for
 * asking, and exactly wrong for handing to a person: a relative path pasted
 * into an agent's prompt resolves against wherever that agent happens to be
 * standing, which is a different tree often enough to be dangerous and never
 * flagged when it goes wrong. So the button copies the machine path, and the
 * machine path exists only when the server tells us the floor.
 *
 * THE FLOOR IS @api's WORD, carried through the seam untouched: `/v1/dir` and
 * `/v1/files` answer with the absolute path of the resolved root, and this
 * module puts the relative back on the end of it. Composition here rather than
 * in the transport because the relative is a property of the ROW, not of the
 * answer - one listing has fifty of them.
 *
 * THE LANE SAYS WHICH LANE (FPLAN-0641). `copyThrough` answers clipboard,
 * legacy or refused, and `copyReport` turns that into the sentence the face
 * shows - so a copy out of a room says whether it landed, and shows the text
 * to copy by hand when it cannot know.
 */

/**
 * Floor plus relative, or nothing at all.
 *
 * NOTHING AT ALL IS A REAL ANSWER, not a defect to paper over. A missing floor
 * means the server did not say where this answer stands, and the only path we
 * could build without it is the relative one - which looks exactly like a path
 * and points somewhere else. The empty string travels up to the button, which
 * refuses out loud rather than handing over a half-answer.
 *
 * THE BRIEF SAID `filter(Boolean)` AND MEASUREMENT SAID IT IS NOT ENOUGH. It
 * handles the empty relative - a root's own listing has one - but a floor of
 * `/` is TRUTHY, so `["/", "notes.md"].filter(Boolean).join("/")` builds
 * `//notes.md`, which is the one case the rule was written to prevent. Measured
 * against the running function rather than reasoned about, five cases:
 *
 *     ("/home/alice", "app/src/main.ts")    -> /home/alice/app/src/main.ts
 *     ("/home/alice", "")                  -> /home/alice
 *     ("/", "notes.md")                    -> /notes.md      (was //notes.md)
 *     ("", "app/src/main.ts")              -> ""             (refuse, no floor)
 *     (undefined, "x")                     -> ""             (refuse, no floor)
 *
 * No root resolves to `/` today, so this was a latent case and not a live bug;
 * it is fixed here rather than left because the whole value of this function is
 * that the string it returns can be trusted without being read.
 *
 * Args:
 *   floor: The absolute path of the resolved root, as the server sent it.
 *   relative: The path within that root, as the listing spelled it.
 *
 * Returns:
 *   The machine path, or "" when there is no floor to stand it on.
 */
export function machinePath(floor: string | undefined, relative: string): string {
  if (!floor) return "";
  // A trailing slash is the server's to send and not ours to argue with - it is
  // taken off here so exactly one separator goes back on below.
  const base = floor.replace(/\/+$/, "");
  if (!relative) return base || "/";
  return `${base}/${relative}`;
}

/**
 * The part of a `<branch>/<relative>` reference that is relative to the root.
 *
 * The wire side of this split lives in the transport (`splitBranchFile`), where
 * it REFUSES a leading slash because a name is not a path. This is the reading
 * side and refuses nothing: a reference that reached a reader already survived
 * that gate, so re-checking it here would be a second opinion on a settled
 * question - and one thrown from inside a render.
 *
 * Args:
 *   ref: `<branch>/<relative>`, or a bare branch name.
 *
 * Returns:
 *   The relative half, or "" when the reference names only a root.
 */
export function underRoot(ref: string): string {
  const cut = ref.indexOf("/");
  return cut < 0 ? "" : ref.slice(cut + 1);
}

/** What the button says when no lane would take the text. */
export const COPY_REFUSED =
  "the browser refused the clipboard - nothing was copied, so nothing is claimed";

/** What the button says when the server has not named the floor. */
export const NO_FLOOR =
  "the server did not say where this root stands - a relative path alone would resolve somewhere else";

/**
 * Which lane took the text: the clipboard API (confirmed), execCommand
 * (claimed, not confirmed), or neither (FPLAN-0641).
 */
export type CopyLane = "clipboard" | "legacy" | "refused";

/** What the face says after a copy, and whether it shows the text to copy by hand. */
export interface CopyReport {
  note: string;
  showText: boolean;
}

/**
 * The truthful sentence for one copy attempt (FPLAN-0641).
 *
 * THREE ANSWERS, AND ONLY ONE OF THEM IS A CONFIRMED COPY. Over plain http on
 * the tailnet `navigator.clipboard` is undefined, so the lane that runs on the
 * S24 today is `execCommand` - and that one can say yes and land nothing. Only
 * the modern lane's resolved promise is a confirmed copy; everything else shows
 * the text in a selectable field, where Android's own long-press Copy is the
 * certain route.
 *
 * Args:
 *   lane: What `copyThrough` answered.
 *   what: The thing copied, as the operator calls it ("the link", "18 characters").
 *
 * Returns:
 *   The note, and whether the text must be shown for a manual copy.
 */
export function copyReport(lane: CopyLane, what: string): CopyReport {
  if (lane === "clipboard") {
    return { note: `copied ${what} - the clipboard confirmed it`, showText: false };
  }
  if (lane === "legacy") {
    return {
      note: `the browser says it copied ${what}, but over plain http it can say that and copy nothing - if paste comes up empty, long-press the text below and choose Copy`,
      showText: true,
    };
  }
  return {
    note: `not copied - the browser refused both clipboard lanes. Long-press the text below and choose Copy`,
    showText: true,
  };
}

/** What a path-copy button does with one lane's answer (DPLAN-0414 A#21). */
export interface CopyShown {
  /** The button may say "copied" - only a lane that CONFIRMED the copy earns it. */
  copied: boolean;
  /** The sentence under the button, or null when the tick says it all. */
  note: string | null;
  /** The text to show in a selectable field for a long-press Copy, or null. */
  byHand: string | null;
}

/**
 * `copyReport` for the two path buttons - a browse row's `copy` and the
 * Reader's `copy path` (DPLAN-0414 A#21 = C#7).
 *
 * THE OWNER'S THUMB FOUND IT: a lock file's path, `copy`, "It lit copied" - over
 * plain http, on the legacy lane, which can say yes and land nothing. Those two
 * buttons used `copyText`, which folds that lane into a yes. This is the
 * truthful pair those buttons now share: the tick only for a confirmed copy,
 * and for the other two lanes `copyReport`'s own sentence with the path held
 * out for Android's long-press Copy - the same answer the terminal's copy gives.
 *
 * Args:
 *   lane: What `copyThrough` answered.
 *   text: The path that was offered to the clipboard.
 *
 * Returns:
 *   Whether to tick, what to say, and what to show for a copy by hand.
 */
export function copyShown(lane: CopyLane, text: string): CopyShown {
  const report = copyReport(lane, "the path");
  if (!report.showText) return { copied: true, note: null, byHand: null };
  return { copied: false, note: report.note, byHand: text };
}

/**
 * Put text on the clipboard, and answer WHICH lane took it.
 *
 * TWO LANES, AND THE SECOND ONE IS THE POINT. This face is served over plain
 * http on the tailnet, and `navigator.clipboard` is UNDEFINED in an insecure
 * context on Android Chrome - the exact browser this face exists for. A copy
 * button written against the modern API alone works on the desktop it was
 * developed on and does nothing at all on the phone, silently. So the legacy
 * lane is not a fallback for old browsers; it is the ONLY lane on the device
 * that matters, and the modern one is the courtesy.
 *
 * THE ORDER IS SYNCHRONOUS-FIRST ON PURPOSE. `execCommand` only works inside
 * the gesture that asked for it, and awaiting a promise ends that gesture. So
 * the absent-API case never awaits anything: it goes straight to the textarea
 * while the tap is still live. Awaiting first and falling back afterwards would
 * have been the natural way to write this and would have failed on the device.
 *
 * NOTHING IS ASSUMED TO HAVE WORKED. Both lanes report: the promise resolves or
 * rejects, `execCommand` answers a boolean, and a `false` from either is
 * returned as `"refused"`. The caller shows a copied state only on an answer
 * that says so - a tick that appears whether or not the text moved is worse
 * than no tick, because it is the operator's only way to know.
 *
 * THE LANE IS THE ANSWER, NOT A BOOLEAN (FPLAN-0641). `"clipboard"` is a
 * resolved promise, a confirmed copy. `"legacy"` is `execCommand` saying yes,
 * which over plain http it can do and land nothing - so `copyReport` words it
 * as a claim and shows the text to copy by hand.
 *
 * Args:
 *   text: What to put on the clipboard. Empty is refused rather than copied -
 *     clearing the clipboard is not what any caller here means.
 *
 * Returns:
 *   `"clipboard"` when `writeText` resolved, `"legacy"` when `execCommand`
 *   said true, `"refused"` otherwise.
 */
export async function copyThrough(text: string): Promise<CopyLane> {
  if (!text) return "refused";

  const modern = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!modern || typeof modern.writeText !== "function") return legacyCopy(text) ? "legacy" : "refused";

  try {
    await modern.writeText(text);
    return "clipboard";
  } catch {
    /* Permission refused, or a document that is not focused. The gesture is
       probably spent by now and the textarea may well fail too - it is tried
       anyway, because a lane that might work beats a lane that cannot, and
       either way the answer below is the truth about what happened. */
    return legacyCopy(text) ? "legacy" : "refused";
  }
}

/**
 * Put text on the clipboard, and answer whether a lane took it.
 *
 * `copyThrough` with the lane folded to a yes or no. NO PATH BUTTON USES IT
 * since DPLAN-0414 A#21 - a yes from the legacy lane is not a copy, and those
 * buttons answer through `copyShown` now. It stays for its test and for any
 * caller that only needs to know some lane took the text. The call still runs synchronously up to the
 * legacy lane, because `copyThrough` is CALLED before anything is awaited.
 *
 * Args:
 *   text: What to put on the clipboard.
 *
 * Returns:
 *   True when either lane said the copy landed.
 */
export async function copyText(text: string): Promise<boolean> {
  return (await copyThrough(text)) !== "refused";
}

/**
 * The textarea lane: select text the page owns and let the browser copy it.
 *
 * `readonly` is not decoration - without it Android raises the soft keyboard
 * over the listing for the length of a copy, and `inputMode = "none"` says the
 * same thing a second way, matching TerminalSheet's scratch field. Off-screen but NOT `display:
 * none`, because a box with no layout has nothing to select. `position: fixed`
 * so a long path cannot scroll the page while it is briefly in the document.
 *
 * Args:
 *   text: What to put on the clipboard.
 *
 * Returns:
 *   Whatever the browser said about the copy, and false if it threw.
 */
function legacyCopy(text: string): boolean {
  const held = document.activeElement;
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.inputMode = "none";
  box.style.position = "fixed";
  box.style.top = "0";
  box.style.left = "0";
  box.style.width = "1px";
  box.style.height = "1px";
  box.style.padding = "0";
  box.style.border = "none";
  box.style.opacity = "0";
  document.body.appendChild(box);

  let landed = false;
  try {
    box.select();
    // iOS ignores `select()` on a readonly box; the range is what it reads.
    box.setSelectionRange(0, text.length);
    landed = document.execCommand("copy");
  } catch {
    landed = false;
  } finally {
    box.remove();
    // The row that was tapped keeps its focus ring - the copy borrowed it.
    if (held instanceof HTMLElement) held.focus();
  }
  return landed;
}
