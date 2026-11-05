/** The extension's host address and token: kept in chrome.storage.local, handed to the shared http transport. */

import { configureHost } from "../../host/transport.http";

export const HOST_KEY = "host";

export interface HostSettings {
  base: string;
  token: string;
}

/** An http(s) origin, or null: the host serves `/v1` at its root, so any path typed after it is dropped. */
export function normalizeBase(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** The match pattern `chrome.permissions.request` takes for one origin. */
export const originPattern = (base: string) => `${base}/*`;

export function asHostSettings(v: unknown): HostSettings | null {
  const s = v as Partial<HostSettings> | null;
  const base = typeof s?.base === "string" ? normalizeBase(s.base) : null;
  return base && typeof s?.token === "string" && s.token ? { base, token: s.token } : null;
}

function apply(v: unknown): HostSettings | null {
  const s = asHostSettings(v);
  // Never unset: unset falls back to the phone's localStorage token, which an extension does not have.
  configureHost(s?.base ?? "", s?.token ?? null);
  return s;
}

/** Read once and follow every later save, so a page or the worker never calls with a stale token. */
export async function loadHost(onChange?: (s: HostSettings | null) => void): Promise<HostSettings | null> {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(HOST_KEY in changes)) return;
    const s = apply(changes[HOST_KEY].newValue);
    onChange?.(s);
  });
  return readHost();
}

export const readHost = async () => apply((await chrome.storage.local.get(HOST_KEY))[HOST_KEY]);

export const saveHost = (s: HostSettings) => chrome.storage.local.set({ [HOST_KEY]: s });
