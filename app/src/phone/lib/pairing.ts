/** QR pairing: trade the `#pair=` fragment (never a query: no access log) for a bearer at `POST /v1/pair`. */

export const PAIR_PREFIX = "#pair=";

/** One line for unknown, expired and used: the server gives one answer for all three. */
export const PAIR_EXPIRED =
  "This pairing code has expired or was already used. On the machine, run: drone @api host-api pair phone --scope operate";

/** The code a pair link carries, or null; the server judges a malformed code as unknown. */
export function pairCodeFrom(hash: string): string | null {
  if (!isPairLink(hash)) return null;
  return hash.slice(PAIR_PREFIX.length).trim() || null;
}

/** Any pair link, empty included: anything that might carry a code leaves the address bar. */
export function isPairLink(hash: string): boolean {
  return hash.startsWith(PAIR_PREFIX);
}

export function addressWithoutFragment(pathname: string, search: string): string {
  return `${pathname}${search}`;
}

/** Duck-typed HostError, so this file imports nothing that knows a URL. */
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

export type Arrival =
  | { kind: "open"; who: Who; paired: boolean }
  | { kind: "expired" }
  | { kind: "refused"; message: string }
  | { kind: "unreachable"; message: string };

function who(answer: { label?: string; scope?: string }): Who {
  return { label: answer.label ?? "", scope: answer.scope ?? "read" };
}

/** Trade a pair code for a token; a stored token the server accepts wins and the code is not spent. */
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

  // The code is spent: a token nobody could check is kept (dropping strands it); a refused one is cleared.
  deps.writeToken(token);
  try {
    return { kind: "open", who: who(await deps.verifyToken(token)), paired: true };
  } catch (error) {
    if (isUnreachable(error)) return { kind: "unreachable", message: said(error) };
    deps.writeToken(null);
    return { kind: "refused", message: said(error) };
  }
}
