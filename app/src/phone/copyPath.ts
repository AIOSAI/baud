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
 *     ("/home/patrick", "app/src/main.ts") -> /home/patrick/app/src/main.ts
 *     ("/home/patrick", "")                -> /home/patrick
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
 * Put text on the clipboard, and answer whether it actually landed.
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
 * returned as `false`. The caller shows a copied state only on `true` - a tick
 * that appears whether or not the text moved is worse than no tick, because it
 * is the operator's only way to know.
 *
 * Args:
 *   text: What to put on the clipboard. Empty is refused rather than copied -
 *     clearing the clipboard is not what any caller here means.
 *
 * Returns:
 *   True only when a lane confirmed the copy.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  const modern = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!modern || typeof modern.writeText !== "function") return legacyCopy(text);

  try {
    await modern.writeText(text);
    return true;
  } catch {
    /* Permission refused, or a document that is not focused. The gesture is
       probably spent by now and the textarea may well fail too - it is tried
       anyway, because a lane that might work beats a lane that cannot, and
       either way the answer below is the truth about what happened. */
    return legacyCopy(text);
  }
}

/**
 * The textarea lane: select text the page owns and let the browser copy it.
 *
 * `readonly` is not decoration - without it Android raises the soft keyboard
 * over the listing for the length of a copy. Off-screen but NOT `display:
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
