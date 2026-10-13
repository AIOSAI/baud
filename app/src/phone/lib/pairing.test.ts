import { describe, expect, it } from "vitest";

import { type PairDeps, PAIR_EXPIRED, addressWithoutFragment, arrive, isPairLink, pairCodeFrom } from "./pairing";

const CODE = "q3Xv_9-kLmN0pQrStUvWxYz0123456789abcdEFGHij";

/** A HostError's shape, as transport.http.ts throws it. */
function hostError(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { status, code });
}

const unreachable = hostError(0, "unreachable", "cannot reach the host API: TypeError: Failed to fetch");
const refusedToken = hostError(401, "unauthorized", "invalid or revoked token");
const expiredCode = hostError(401, "invalid", "pairing code unknown, expired or already used");

/**
 * A recording stand-in for the transport. `tokens` maps a token to its whoami
 * answer or to the error whoami throws for it; `redeem` is what POST /v1/pair does.
 */
function deps(
  stored: string | null,
  tokens: Record<string, { label: string; scope: string } | Error>,
  redeem: () => Promise<{ token: string }>,
) {
  const log: string[] = [];
  let held = stored;
  const d: PairDeps = {
    readToken: () => held,
    writeToken: (token) => {
      log.push(`write ${token}`);
      held = token;
    },
    verifyToken: async (token) => {
      log.push(`verify ${token}`);
      const answer = tokens[token];
      if (answer instanceof Error) throw answer;
      if (!answer) throw refusedToken;
      return answer;
    },
    redeemPairing: async (code) => {
      log.push(`redeem ${code}`);
      return redeem();
    },
  };
  return { d, log, held: () => held };
}

describe("pairCodeFrom", () => {
  it("reads the code out of a pair link's fragment", () => {
    expect(pairCodeFrom(`#pair=${CODE}`)).toBe(CODE);
  });

  it("is null for no fragment, another fragment, or an empty code", () => {
    expect(pairCodeFrom("")).toBeNull();
    expect(pairCodeFrom("#files")).toBeNull();
    expect(pairCodeFrom("#pair=")).toBeNull();
    expect(pairCodeFrom("#pair=   ")).toBeNull();
  });

  it("does not read a pair key that is not the whole fragment's start", () => {
    expect(pairCodeFrom(`#x&pair=${CODE}`)).toBeNull();
    expect(pairCodeFrom(`?pair=${CODE}`)).toBeNull();
  });

  it("trims the whitespace a scanner can leave, and nothing else", () => {
    expect(pairCodeFrom(`#pair=${CODE} `)).toBe(CODE);
    expect(pairCodeFrom("#pair=a%20b")).toBe("a%20b");
  });
});

describe("the strip", () => {
  it("treats every pair link as one to strip, an empty one included", () => {
    expect(isPairLink(`#pair=${CODE}`)).toBe(true);
    expect(isPairLink("#pair=")).toBe(true);
    expect(isPairLink("#files")).toBe(false);
    expect(isPairLink("")).toBe(false);
  });

  it("puts back the path and query with the fragment gone", () => {
    expect(addressWithoutFragment("/", "")).toBe("/");
    expect(addressWithoutFragment("/phone.html", "?v=2")).toBe("/phone.html?v=2");
  });
});

describe("arrive", () => {
  it("redeems the code, writes the token, then proves it with whoami", async () => {
    const { d, log, held } = deps(null, { fresh: { label: "phone", scope: "operate" } }, async () => ({ token: "fresh" }));
    expect(await arrive(CODE, d)).toEqual({ kind: "open", who: { label: "phone", scope: "operate" }, paired: true });
    expect(log).toEqual([`redeem ${CODE}`, "write fresh", "verify fresh"]);
    expect(held()).toBe("fresh");
  });

  it("lets a stored, working token win, and never spends the code", async () => {
    const { d, log } = deps("old", { old: { label: "s24", scope: "read" } }, async () => ({ token: "fresh" }));
    expect(await arrive(CODE, d)).toEqual({ kind: "open", who: { label: "s24", scope: "read" }, paired: false });
    expect(log).toEqual(["verify old"]);
  });

  it("replaces a stored token the server refuses with the paired one", async () => {
    const { d, log, held } = deps("dead", { fresh: { label: "phone", scope: "operate" } }, async () => ({ token: "fresh" }));
    expect((await arrive(CODE, d)).kind).toBe("open");
    expect(log).toEqual(["verify dead", `redeem ${CODE}`, "write fresh", "verify fresh"]);
    expect(held()).toBe("fresh");
  });

  it("stops at unreachable when the stored token cannot be checked, code unspent", async () => {
    const { d, log } = deps("old", { old: unreachable }, async () => ({ token: "fresh" }));
    expect(await arrive(CODE, d)).toEqual({ kind: "unreachable", message: unreachable.message });
    expect(log).toEqual(["verify old"]);
  });

  it("is expired on a 401 from the redeem, and writes nothing", async () => {
    const { d, log, held } = deps(null, {}, async () => {
      throw expiredCode;
    });
    expect(await arrive(CODE, d)).toEqual({ kind: "expired" });
    expect(log).toEqual([`redeem ${CODE}`]);
    expect(held()).toBeNull();
  });

  it("keeps a redeem nobody answered apart from a refused one", async () => {
    const { d } = deps(null, {}, async () => {
      throw unreachable;
    });
    expect(await arrive(CODE, d)).toEqual({ kind: "unreachable", message: unreachable.message });
  });

  it("says the server's own words for a refusal that is not a 401", async () => {
    const tooMany = hostError(429, "rate_limited", "too many pairing attempts; wait a minute");
    const { d } = deps(null, {}, async () => {
      throw tooMany;
    });
    expect(await arrive(CODE, d)).toEqual({ kind: "refused", message: tooMany.message });
  });

  it("keeps a paired token whose proof nobody answered: the code is already spent", async () => {
    const { d, held } = deps(null, { fresh: unreachable }, async () => ({ token: "fresh" }));
    expect((await arrive(CODE, d)).kind).toBe("unreachable");
    expect(held()).toBe("fresh");
  });

  it("clears a paired token the server then refuses", async () => {
    const { d, log, held } = deps(null, { fresh: refusedToken }, async () => ({ token: "fresh" }));
    expect(await arrive(CODE, d)).toEqual({ kind: "refused", message: refusedToken.message });
    expect(log).toEqual([`redeem ${CODE}`, "write fresh", "verify fresh", "write null"]);
    expect(held()).toBeNull();
  });

  it("defaults a whoami with no label or scope to an empty label and read", async () => {
    const { d } = deps(null, { fresh: {} as { label: string; scope: string } }, async () => ({ token: "fresh" }));
    expect(await arrive(CODE, d)).toEqual({ kind: "open", who: { label: "", scope: "read" }, paired: true });
  });

  it("names the command a stranger runs for a fresh code", () => {
    expect(PAIR_EXPIRED).toBe(
      "This pairing code has expired or was already used. On the machine, run: drone @api host-api pair phone --scope operate",
    );
  });
});
