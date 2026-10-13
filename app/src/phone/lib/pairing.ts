/**
 * The pair door's reading and its one decision (DPLAN-0406 / FPLAN-0643; the
 * owner, 2026-10-13: "qr pairing thats it right there ... it auto connects.
 * qr expires after 5 mins"; contract devpulse/docs.local/contract_pairing_door_2026-10-13.md).
 *
 * The machine shows a QR of `http://<bind>/#pair=<code>`. The phone's camera
 * opens it, and this face trades the code for a real bearer at `POST /v1/pair`.
 * The token is never on a screen, in a file someone has to move, or in a mail.
 *
 * PURE AND INJECTED. The fetches live in transport.http.ts, the one file that
 * knows a URL. `arrive` takes them as arguments, so the whole decision table
 * (stored token wins, a code is spent at most once, refused and unreachable
 * kept apart) is tested here without a server.
 *
 * THE FRAGMENT, NOT THE QUERY. A fragment never leaves the phone in a request
 * line, so the code is in no access log. It is still in the address bar and the
 * history row until `replaceState` takes it out, which is the first thing the
 * face does with it.
 */

/** What a pair link's fragment starts with. */
export const PAIR_PREFIX = "#pair=";

/** The door's line when the server refused the code (contract: one answer for
 *  unknown, expired and used, so one line for all three). */
export const PAIR_EXPIRED =
  "This pairing code has expired or was already used. On the machine, run: drone @api host-api pair phone --scope operate";

/**
 * The code a pair link carries.
 *
 * Args:
 *   hash: `location.hash`, with its `#`.
 *
 * Returns:
 *   The code, or null when the fragment is not a pair link or carries an empty
 *   code. The server judges the code itself: a malformed one is an unknown one,
 *   and gets the same single refusal.
 */
export function pairCodeFrom(hash: string): string | null {
  if (!isPairLink(hash)) return null;
  // The code is token_urlsafe: nothing in it needs decoding, so nothing is.
  return hash.slice(PAIR_PREFIX.length).trim() || null;
}

/**
 * True when the fragment is a pair link of any shape, empty included. Anything
 * that might carry a code leaves the address bar, whether or not it is used.
 */
export function isPairLink(hash: string): boolean {
  return hash.startsWith(PAIR_PREFIX);
}

/**
 * The address to put back with `history.replaceState`: the same page with the
 * fragment gone.
 *
 * Args:
 *   pathname: `location.pathname`.
 *   search: `location.search`, with its `?` or empty.
 */
export function addressWithoutFragment(pathname: string, search: string): string {
  return `${pathname}${search}`;
}

/** The fields of a HostError this decision reads. Duck-typed so this file
 *  imports nothing that knows a URL. */
interface Failure {
  status?: number;
  code?: string;
  message?: string;
}

function failure(error: unknown): Failure {
  return typeof error === "object" && error !== null ? (error as Failure) : { message: String(error) };
}

function isUnreachable(error: unknown): boolean {
  return failure(error).code === "unreachable";
}

function said(error: unknown): string {
  return failure(error).message ?? String(error);
}

export interface Who {
  label: string;
  scope: string;
}

export interface PairDeps {
  readToken: () => string | null;
  writeToken: (token: string | null) => void;
  verifyToken: (token: string) => Promise<{ label?: string; scope?: string }>;
  redeemPairing: (code: string) => Promise<{ token: string }>;
}

/**
 * How an arrival with a pair link ends.
 *
 *   open         - a token is held and the server proved it; `paired` says
 *                  whether it came from this code or was already stored.
 *   expired      - the server refused the code (401): the door, with PAIR_EXPIRED.
 *   refused      - the server answered no for another reason (429, 400): the
 *                  door, with the server's own words.
 *   unreachable  - nothing answered: the door's unreachable branch, as today.
 */
export type Arrival =
  | { kind: "open"; who: Who; paired: boolean }
  | { kind: "expired" }
  | { kind: "refused"; message: string }
  | { kind: "unreachable"; message: string };

function who(answer: { label?: string; scope?: string }): Who {
  return { label: answer.label ?? "", scope: answer.scope ?? "read" };
}

/**
 * Trade a pair code for a token, unless a working token is already held.
 *
 * A STORED, WORKING TOKEN WINS: the code is not spent. A stored token the
 * server refuses is a dead one, and the code replaces it. A stored token
 * nobody could check stops here as unreachable, because the redeem would hit
 * the same silence and burn nothing useful.
 *
 * Args:
 *   code: The pair code from the fragment.
 *   deps: The transport's token store and the two calls.
 */
export async function arrive(code: string, deps: PairDeps): Promise<Arrival> {
  const stored = deps.readToken();
  if (stored) {
    try {
      return { kind: "open", who: who(await deps.verifyToken(stored)), paired: false };
    } catch (error) {
      if (isUnreachable(error)) return { kind: "unreachable", message: said(error) };
    }
  }

  let token: string;
  try {
    token = (await deps.redeemPairing(code)).token;
  } catch (error) {
    if (isUnreachable(error)) return { kind: "unreachable", message: said(error) };
    if (failure(error).status === 401) return { kind: "expired" };
    return { kind: "refused", message: said(error) };
  }

  // Written exactly as a pasted token is, then proved the same way the door
  // proves a paste. The code is spent by now, so a token whose proof nobody
  // could check is kept (dropping it would strand a working credential); one
  // the server refuses is dead, and is cleared like a sign-out.
  deps.writeToken(token);
  try {
    return { kind: "open", who: who(await deps.verifyToken(token)), paired: true };
  } catch (error) {
    if (isUnreachable(error)) return { kind: "unreachable", message: said(error) };
    deps.writeToken(null);
    return { kind: "refused", message: said(error) };
  }
}
