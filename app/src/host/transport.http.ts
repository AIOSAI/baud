/** The http transport: the host seam bound to `fetch` against @api's `/v1`; the only file that knows a URL. */

import { withRef } from "./errorRef";

/** Where `/v1` lives. Empty is same-origin, so a bundle @api serves needs no configuration. */
const API_BASE = (import.meta.env.VITE_BAUD_API ?? "").replace(/\/+$/, "");

export function apiOrigin(): string {
  return API_BASE || window.location.origin;
}

const TOKEN_KEY = "baud.phone.token";

/** Browsers cannot set `Authorization` on a WebSocket and a query token lands in logs, so it rides the subprotocol. */
const BEARER_SENTINEL = "aipass.bearer";

export function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // private mode, or storage disabled - treated as signed out
  }
}

export function writeToken(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(TOKEN_KEY);
    else window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* the paste screen will simply ask again next load */
  }
}

/** A host call that failed with the server's own words, kept verbatim. */
export class HostError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HostError";
    this.status = status;
    this.code = code;
  }

  /** True when the token is missing, wrong, or out of scope. */
  get unauthorized(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** The server's sentence: the `error` envelope (with `ref`), then validation's `detail`, then the status. */
function errorFrom(body: any, status: number): HostError {
  const envelope = body?.error;
  if (envelope?.message) {
    return new HostError(status, envelope.code ?? "error", withRef(envelope.message, envelope.ref));
  }

  const detail = body?.detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const said = detail
      .map((item: any) => {
        const where = Array.isArray(item?.loc) ? item.loc.filter((p: unknown) => p !== "body").join(".") : "";
        return where ? `${where}: ${item?.msg ?? "invalid"}` : (item?.msg ?? "invalid");
      })
      .join("; ");
    return new HostError(status, "invalid", said);
  }
  if (typeof detail === "string" && detail) return new HostError(status, "invalid", detail);

  return new HostError(status, "error", `HTTP ${status}`);
}

type Query = Record<string, string | number | boolean | null | undefined>;

interface Route {
  path: string;
  method?: "GET" | "POST";
  query?: (args: Record<string, unknown>) => Query;
  body?: (args: Record<string, unknown>) => Record<string, unknown>;
  unwrap?: (body: any) => unknown;
}

/** Seam verb (the Rust command name) -> `/v1` route. */
const ROUTES: Record<string, Route> = {
  // The reserved prefix keeps the enrollment probe from colliding with a Rust command.
  __whoami: {
    path: "/v1/whoami",
  },
  fleet_snapshot: {
    // `project` rides the generic lift in `call`: the phone's seat is client state.
    path: "/v1/fleet",
  },
  list_projects: {
    path: "/v1/projects",
    unwrap: (body) => body?.projects ?? [],
  },
  agent_roster: {
    // @baud's cross-project sweep, not /v1/fleet: the fleet route serves one project only.
    path: "/v1/roster",
    unwrap: (body) => body?.branches ?? [],
  },
  machine_vitals: {
    // No query, ever: the route answers any parameter (a cache-buster too) with 400.
    path: "/v1/machine",
  },
  machine_processes: {
    // `limit` is the one parameter; undefined is dropped, so a bare call gets the server default.
    path: "/v1/machine/processes",
    query: (args) => ({ limit: args.limit as number | undefined }),
  },
  lock_state: {
    // No query, ever: any parameter is a 400. `ok: false` is a 200 carrying the skill's sentence.
    path: "/v1/lock",
  },
  /* `root` names the kind of place and rides only when a caller names one; absent keeps the
     branch meaning. The first component of `path` names the thing within that kind. */
  list_roots: {
    path: "/v1/roots",
    unwrap: (body) => (Array.isArray(body?.roots) ? body.roots : []),
  },
  list_dir_window: {
    path: "/v1/dir",
    query: (args) => {
      const split = splitBranchFile(String(args.path ?? ""));
      return { branch: split.branch, dir: split.file, root: args.root as string, offset: args.offset as number | undefined };
    },
    unwrap: (body) => ({
      entries: body?.entries ?? [],
      truncated: Boolean(body?.truncated),
      total: typeof body?.total === "number" ? body.total : undefined,
      floor: floorOf(body),
    }),
  },
  read_file_text: {
    // Names, never paths: @api's fence takes a branch and a file, so `path` is split here.
    path: "/v1/files",
    query: (args) => ({ ...splitBranchFile(String(args.path ?? "")), root: args.root as string }),
    unwrap: (body) => ({
      path: `${body?.branch ?? ""}/${body?.file ?? ""}`,
      content: body?.content ?? "",
      truncated: Boolean(body?.truncated),
      floor: floorOf(body),
    }),
  },
  git_diff_text: {
    path: "/v1/diff",
    query: (args) => ({ branch: branchOf(String(args.path ?? "")) }),
    unwrap: (body) => ({
      path: body?.branch ?? "",
      content: body?.diff ?? "",
      truncated: Boolean(body?.truncated),
    }),
  },
  // `untracked` is dropped on purpose: the desktop's GIT tile counts tracked files only, and both must agree.
  git_changes: {
    path: "/v1/git-changes",
    // Absent `grain` is the branch's own subtree, the server default and every older caller's meaning.
    query: (args) => ({
      branch: branchOf(String(args.path ?? "")),
      grain: args.grain as string,
    }),
    unwrap: (body) => ({
      files: Array.isArray(body?.files) ? body.files.map(String) : [],
      count: Number(body?.count ?? 0),
    }),
  },

  /* The git app's reads, asked whole. Nothing is pre-refused: @api's sentences answer bad
     limits and combinations, and a guard here would replace them with a guess. */

  git_change_count: {
    // Two numbers, no arrays: two pollers ask this about thirteen times a minute.
    path: "/v1/git-changes",
    query: (args) => ({ branch: args.branch as string, grain: args.grain as string }),
    unwrap: (body) => ({
      count: Number(body?.count ?? 0),
      untracked: Number(body?.untracked ?? 0),
    }),
  },
  git_change_rows: {
    path: "/v1/git-changes",
    query: (args) => ({ branch: args.branch as string, grain: args.grain as string }),
    // A non-list field becomes empty, so a changed lane renders "nothing changed" instead of throwing.
    unwrap: (body) => ({
      branch: String(body?.branch ?? ""),
      grain: String(body?.grain ?? ""),
      files: Array.isArray(body?.files) ? body.files.map(String) : [],
      count: Number(body?.count ?? 0),
      untracked: Number(body?.untracked ?? 0),
      rows: Array.isArray(body?.rows)
        ? body.rows.map((row: any) => ({ path: String(row?.path ?? ""), status: String(row?.status ?? "") }))
        : [],
      root:
        typeof body?.root?.kind === "string"
          ? { kind: body.root.kind, name: typeof body.root.name === "string" ? body.root.name : null }
          : null,
    }),
  },
  git_file_diff: {
    path: "/v1/diff",
    // `staged` is never sent: it is a desk concern, and the parameter refuses beside a ref.
    query: (args) => ({
      branch: args.branch as string,
      path: args.path as string,
      grain: args.grain as string,
      ref: args.ref as string,
    }),
  },
  git_log: {
    path: "/v1/git-log",
    query: (args) => ({ branch: args.branch as string, limit: args.limit as number }),
  },
  git_commit: {
    path: "/v1/commit",
    query: (args) => ({ branch: args.branch as string, ref: args.ref as string }),
  },
  git_remote: {
    // The envelope whole: the browsable and configured URLs differ, and the server already normalized `web`.
    path: "/v1/git-remote",
    query: (args) => ({ branch: args.branch as string }),
  },
  notifications_read: {
    path: "/v1/feed",
    query: (args) => ({ since: args.since as string, limit: args.limit as number }),
    unwrap: (body) => body?.events ?? [],
  },
  // The same route with the envelope kept: the feed screen needs the cursor and `gap`.
  notifications_feed: {
    path: "/v1/feed",
    query: (args) => ({ since: args.since as string, limit: args.limit as number }),
  },

  // No model field: the branch's own config decides what wakes.
  verb_wake: {
    path: "/v1/verbs/wake",
    method: "POST",
    body: (args) => ({
      branch: args.branch,
      project: args.project,
      message: args.message,
    }),
  },

  // The project is required: a room name carries its project scope, so inferring it kills the wrong session.
  verb_kill: {
    path: "/v1/verbs/kill",
    method: "POST",
    body: (args) => ({ branch: args.branch, project: args.project }),
  },

  verb_lock: {
    path: "/v1/verbs/lock",
    method: "POST",
    body: () => ({}),
  },

  verb_new_project: {
    path: "/v1/verbs/new-project",
    method: "POST",
    body: (args) => ({ name: args.name, template: args.template }),
  },

  /* Shapes in docs/phone/backup.md. `call` puts `project` on the query for status; run carries it in the body. */

  backup_run: {
    path: "/v1/backup/run",
    method: "POST",
    body: (args) => ({ project: args.project, lane: args.lane }),
  },
  backup_job: {
    path: "/v1/backup/job",
    query: (args) => ({ id: args.id as string }),
  },
  // An absent `sizes` is the cheap read; the store walk is only asked for by name.
  backup_status: {
    path: "/v1/backup/status",
    query: (args) => ({ sizes: args.sizes ? 1 : undefined }),
  },
  backup_cancel: {
    path: "/v1/backup/cancel",
    method: "POST",
    body: (args) => ({ project: args.project, lane: args.lane }),
  },

  /* Patches cross untouched: JSON.stringify keeps null and drops undefined, which IS the
     three-state contract, so no body mapper may "clean" a patch here. */

  agent_settings_read: {
    path: "/v1/agent-settings",
    query: (args) => ({ branch: String(args.agent ?? "") }),
  },
  agent_settings_write: {
    path: "/v1/agent-settings",
    method: "POST",
    // The host takes the write's project in the body; `call` lifts it onto the query for the read only.
    body: (args) => ({ branch: args.agent, patch: args.patch, project: args.project }),
  },
  baud_settings_read: {
    path: "/v1/baud-settings",
  },
  baud_settings_write: {
    path: "/v1/baud-settings",
    method: "POST",
    body: (args) => ({ patch: args.patch }),
  },
  hooks_sound_get: {
    path: "/v1/hooks-sound",
    unwrap: (body) => Boolean(body?.active),
  },
  hooks_sound_set: {
    path: "/v1/hooks-sound",
    method: "POST",
    body: (args) => ({ active: args.active }),
    unwrap: (body) => Boolean(body?.active),
  },

  /* @api's envelope is not MemoryConfig, so it is translated here. Character caps and the
     rollover group are not on the wire and are not invented. */

  memory_config_read: {
    path: "/v1/memory-config",
    unwrap: (body) => fleetMemoryConfig(body),
  },
  memory_config_set: {
    path: "/v1/memory-config/set",
    method: "POST",
    body: (args) => ({ branch: args.branch, type: args.entryType, count: args.count }),
    unwrap: (body) => refusalGuard(body),
  },
  memory_config_set_default: {
    path: "/v1/memory-config/set-default",
    method: "POST",
    body: (args) => ({ type: args.entryType, count: args.count }),
    unwrap: (body) => refusalGuard(body),
  },
  memory_config_push: {
    path: "/v1/memory-config/push",
    method: "POST",
    body: () => ({}),
    unwrap: (body) => refusalGuard(body),
  },

  // No terminal route: the room is a stream, and `openRoomSocket` is its door.
};

/** Verbs the phone knows and cannot perform: a designed absence, distinct from an unrouted bug. */
const NOT_YET: Record<string, string> = {
  project_switch:
    "the phone keeps its seat locally and passes it on every read - there is no server seat to switch",
  list_dir:
    "the phone browses through list_dir_window - the desktop tree's absolute entry paths have no meaning on this fence",
  git_project_changes: "the project-wide count has no route yet",
  resolve_paths: "path resolution is a desktop drag-and-drop concern and has no phone gesture",
  room_kill: "the phone ends a room through verb_kill, which names its project explicitly",
  pty_create: "the phone attaches a real terminal by deep link, never a webview emulator",
  pty_write: "no webview terminal on the phone - see pty_create",
  pty_resize: "no webview terminal on the phone - see pty_create",
  pty_kill: "no webview terminal on the phone - see pty_create",
  monitor_create: "monitor panes are a desktop pane concern",
  /* Character caps have no host route; @api serves the rollover lane only. */
  memory_config_write:
    "entry character caps have no /v1 route - only the rollover limits are served here, and the desktop gear owns the caps",
  screenshot_capture: "this captures the MACHINE's screen through its compositor - there is none to capture from a phone",
};

/** The absolute path of the root an answer stands on; "" when absent so composition refuses, not half-builds. */
function floorOf(body: any): string {
  return typeof body?.floor === "string" ? body.floor : "";
}

function splitBranchFile(path: string): Query {
/** `<branch>/<file>` -> @api's two names. An absolute path is refused: stripping it would ask for branch "home". */
  if (path.startsWith("/")) {
    throw new HostError(
      400,
      "path_not_a_name",
      `the host API is fenced on NAMES, not paths - pass '<branch>/<file>', got '${path}'`,
    );
  }
  const cut = path.indexOf("/");
  if (cut <= 0) return { branch: path, file: "" };
  return { branch: path.slice(0, cut), file: path.slice(cut + 1) };
}

function branchOf(path: string): string {
  return String(splitBranchFile(path).branch ?? "");
}

/** Entry type -> `.trinity/` file, per `drone @memory config --help`; unknown types visibly match nothing. */
const ROLLOVER_GROUPS: Record<string, string> = {
  sessions: "local",
  key_learnings: "local",
  observations: "observations",
};

function groupOf(entryType: string): string {
  return ROLLOVER_GROUPS[entryType] ?? entryType;
}

/** A refusal with a 200 status (`{ok: false}`); @api's 400 refusals already go through `errorFrom`. */
function refusalGuard(body: any): unknown {
  if (body?.ok === false) {
    const envelope = body?.error;
    const said = String(envelope?.message ?? body?.detail ?? "@memory refused, without saying why");
    const offered = typeof envelope?.suggestion === "string" ? envelope.suggestion.trim() : "";
    throw new HostError(
      400,
      String(envelope?.code ?? "memory_config_refused"),
      offered && !said.includes(offered) ? `${said} — Try: ${offered}` : said,
    );
  }
  return body;
}

/** Fleet envelope -> `MemoryConfig`. `path`/`enforced` are null (unknown) so the shared panel draws nothing. */
function fleetMemoryConfig(body: any): unknown {
  const defaults = (body?.defaults ?? {}) as Record<string, { count?: number; auto_compact_cap?: number | null }>;
  const rollover = Object.entries(defaults).map(([key, dial]) => ({
    group: groupOf(key),
    key,
    count: Number(dial?.count ?? 0),
    auto_compact_cap: dial?.auto_compact_cap ?? null,
  }));
  const overrides = Array.isArray(body?.overrides) ? body.overrides : [];
  const per_branch = overrides.map((entry: any) => ({
    branch: String(entry?.branch ?? ""),
    dials: (Array.isArray(entry?.limits) ? entry.limits : []).map((limit: any) => ({
      group: groupOf(String(limit?.type ?? "")),
      key: String(limit?.type ?? ""),
      count: Number(limit?.count ?? 0),
      auto_compact_cap: limit?.auto_compact_cap ?? null,
    })),
  }));
  return {
    path: null,
    enforced: null,
    entry_limits: [],
    rollover,
    per_branch,
  };
}

function queryString(query: Record<string, string>): string {
  const parts = Object.entries(query).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/** What a face sends: a fenced `/v1` request, its query already stringified and emptied of blanks. */
export interface WireRequest {
  method: "GET" | "POST";
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown> | null;
}

/** What a face hands back: the status and the raw body, parsed once by `callWith` for every face. */
export interface WireResponse {
  status: number;
  body: string;
}

export type Sender = (request: WireRequest) => Promise<WireResponse>;

/** The phone's sender: `fetch` with the pasted token. */
const fetchSender: Sender = async (request) => {
  const token = readToken();
  if (!token) throw new HostError(401, "no_token", "no token - paste one to connect");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (request.body !== null) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${request.path}${queryString(request.query)}`, {
      method: request.method,
      headers,
      body: request.body === null ? undefined : JSON.stringify(request.body),
    });
  } catch (cause) {
    // A network failure is not a rejected token: re-paste versus check the server.
    throw new HostError(0, "unreachable", `cannot reach the host API: ${String(cause)}`);
  }
  return { status: response.status, body: await response.text().catch(() => "") };
};

/** Seam verb and args -> the wire request, or the designed refusal. */
export function wireRequest(command: string, args?: Record<string, unknown>): WireRequest {
  const refusal = NOT_YET[command];
  if (refusal) throw new HostError(501, "not_on_the_phone", `${command}: ${refusal}`);

  const route = ROUTES[command];
  if (!route) throw new HostError(501, "unrouted", `${command} has no /v1 route - the seam grew and this table did not`);

  const query: Query = route.query ? route.query(args ?? {}) : {};
  const project = (args?.project as string) ?? "";
  if (project) query.project = project;

  const method = route.method ?? "GET";
  const sent: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") sent[key] = String(value);
  }
  return {
    method,
    path: route.path,
    query: sent,
    body: method === "POST" ? (route.body ? route.body(args ?? {}) : {}) : null,
  };
}

/** A typed host call through any sender: one parse, so `HostError` means the same on every face. */
export async function callWith<T>(send: Sender, command: string, args?: Record<string, unknown>): Promise<T> {
  const request = wireRequest(command, args);
  const response = await send(request);

  if (response.status === 204) return undefined as T;

  let body: any = null;
  try {
    body = JSON.parse(response.body);
  } catch {
    body = null;
  }

  if (response.status < 200 || response.status > 299) throw errorFrom(body, response.status);

  const route = ROUTES[command];
  return (route.unwrap ? route.unwrap(body) : body) as T;
}

/** A typed host call. The only `fetch` in the application. */
export function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return callWith<T>(fetchSender, command, args);
}

export async function verifyToken(token: string): Promise<{ id: string; label: string; scope: string }> {
  const previous = readToken();
  writeToken(token);
  try {
    return await call<{ id: string; label: string; scope: string }>("__whoami");
  } finally {
    if (previous !== token) writeToken(previous);
  }
}

/** Its own fetch, not `call`: `call` refuses without a token, which is the state a pairing phone is in. */
export async function redeemPairing(code: string): Promise<{ token: string; id: string; label: string; scope: string }> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/v1/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ code }),
    });
  } catch (cause) {
    throw new HostError(0, "unreachable", `cannot reach the host API: ${String(cause)}`);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) throw errorFrom(body, response.status);
  // A 200 with no token: the code is spent and nothing could be stored.
  if (typeof body?.token !== "string" || !body.token) {
    throw new HostError(502, "no_token", "the pairing answered but carried no token - pair again");
  }
  return body;
}

export function openExternal(url: string): Promise<void> {
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve();
}

/** The desktop's tauri pty channel; exported so the seam's shape matches, and constructing it throws. */
export class HostChannel {
  constructor() {
    throw new HostError(501, "not_on_the_phone", "tauri event channels are desktop-only - the phone streams a room over a socket");
  }
}

/** Multipart, so not through `call`; never set `Content-Type` by hand or the boundary breaks. */
export async function uploadImage(file: File): Promise<string> {
  const token = readToken();
  if (!token) throw new HostError(401, "unauthorized", "no token - sign in before sending a photo");

  const form = new FormData();
  // The field name `image` is pinned by @api's route; a mismatch answers 422.
  form.append("image", file, file.name);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/v1/files/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      body: form,
    });
  } catch (cause) {
    throw new HostError(0, "unreachable", `cannot reach the host API: ${String(cause)}`);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) throw errorFrom(body, response.status);
  // A 200 with no path would type "undefined" into a live room.
  const path = typeof body === "string" ? body : (body?.path ?? null);
  if (typeof path !== "string" || !path) {
    throw new HostError(502, "no_path", "the upload succeeded but named no path - nothing to deliver");
  }
  return path;
}

/** Attach a tmux client to a room. A closed socket is a detach, never an end. */
export function openRoomSocket(branch: string, project: string, kind = ""): WebSocket {
  const token = readToken();
  if (!token) {
    throw new HostError(401, "unauthorized", "no token - sign in before attaching a room");
  }
  // The page's protocol picks ws or wss, so a TLS page never opens a cleartext socket.
  const base = API_BASE
    ? API_BASE.replace(/^http/, "ws")
    : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
  const query = new URLSearchParams({ branch, project });
  // `kind` is absent for agent attaches, so that handshake is unchanged.
  if (kind) query.set("kind", kind);
  return new WebSocket(`${base}/v1/room/attach?${query}`, [BEARER_SENTINEL, token]);
}
