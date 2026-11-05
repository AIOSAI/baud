import { afterEach, describe, expect, it, vi } from "vitest";

import { call, configureHost } from "../../host/transport.http";
import { HOST_KEY, asHostSettings, loadHost, normalizeBase, originPattern } from "./hostConfig";

// vitest has no build alias, so the http transport's own `call` stands in for the verb the extension build routes there
const fleetSnapshot = () => call("fleet_snapshot");

afterEach(() => {
  vi.unstubAllGlobals();
  configureHost("", null);
});

describe("host address", () => {
  it("keeps an http(s) origin and drops paths", () => {
    expect(normalizeBase(" http://127.0.0.1:8787/ ")).toBe("http://127.0.0.1:8787");
    expect(normalizeBase("https://box.tail.ts.net/v1/fleet")).toBe("https://box.tail.ts.net");
    expect(normalizeBase("ftp://x")).toBeNull();
    expect(normalizeBase("not a url")).toBeNull();
    expect(originPattern("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787/*");
  });

  it("needs both address and token", () => {
    expect(asHostSettings({ base: "http://h:1", token: "t" })).toEqual({ base: "http://h:1", token: "t" });
    expect(asHostSettings({ base: "http://h:1", token: "" })).toBeNull();
    expect(asHostSettings({ base: "nope", token: "t" })).toBeNull();
    expect(asHostSettings(undefined)).toBeNull();
  });
});

describe("the transport seam", () => {
  it("sends the stored base and token through the shared host client", async () => {
    vi.stubGlobal("chrome", {
      storage: {
        local: { get: async () => ({ [HOST_KEY]: { base: "http://h:8787", token: "tok" } }) },
        onChanged: { addListener: () => undefined },
      },
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ branches: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await loadHost();
    await fleetSnapshot();

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://h:8787/v1/fleet");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("refuses before any request with nothing stored", async () => {
    vi.stubGlobal("chrome", { storage: { local: { get: async () => ({}) }, onChanged: { addListener: () => undefined } } });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await loadHost();
    await expect(fleetSnapshot()).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
