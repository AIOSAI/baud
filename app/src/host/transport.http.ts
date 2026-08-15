/**
 * The transport, second implementation: the same host seam over HTTP
 * (FPLAN-0413 phase 1).
 *
 * `transport.ts` binds the seam to tauri's `invoke`. This file binds the exact
 * same surface - `call`, `openExternal`, `HostChannel` - to `fetch` against
 * @api's host API (FPLAN-0411). A build picks one; `host/index.ts` and every
 * component above it are identical either way. That is the property the phone
 * face rests on, and it only holds while this file stays the ONLY place that
 * knows a URL.
 *
 * WHY A TABLE. The seam is command-shaped (`fleet_snapshot`, `git_diff_text`)
 * because tauri commands are; `/v1` is REST-shaped because HTTP is. Something
 * has to translate, and translating here keeps `host/index.ts` untouched. The
 * alternative - teaching the components which shape they are talking to - is
 * exactly the coupling the seam exists to prevent.
 *
 * WHAT IS DELIBERATELY MISSING. Only the READ lane is routed. Every writing
 * verb, every pty, every monitor is refused BY NAME with a sentence saying the
 * phone cannot do it yet. Silence would be worse: a button that quietly does
 * nothing reads as a broken app, while a refusal that names itself reads as a
 * feature that has not landed. Phase 6 fills these in behind the verb ruling.
 */

/* ------------------------------------------------------------- the wire -- */

/** Where `/v1` lives. Same-origin by default, so a bundle @api serves needs no
 *  configuration at all; the dev proxy and any future split origin override it. */
const API_BASE = (import.meta.env.VITE_BAUD_API ?? "").replace(/\/+$/, "");

const TOKEN_KEY = "baud.phone.token";

/**
 * The bearer sentinel, and the reason the token rides a subprotocol at all.
 *
 * A browser cannot set an `Authorization` header on a WebSocket - the API takes
 * a URL and a subprotocol list and nothing else. The query string is the
 * obvious workaround and the wrong one: URLs land in access logs, proxy logs
 * and browser history, so a token there outlives the socket in three places
 * nobody remembers to clear. `Sec-WebSocket-Protocol` is a request HEADER, so
 * it goes where credentials go. @api matches the token positionally as the
 * value that is not this sentinel, and echoes back only the sentinel.
 */
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

/**
 * A host call that failed with the server's own words.
 *
 * @api sends every error through one envelope - `{"error":{"code","message"}}` -
 * so a 503 carrying BAUD's own snapshot sentence ("no project named 'baud' in
 * BAUD's census") arrives at the card AS that sentence. Flattening it to
 * "request failed" would throw away the one thing that makes a remote read
 * debuggable from a phone.
 */
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

/**
 * The server's own sentence, whichever shape it arrived in.
 *
 * @api answers errors through one envelope - `{"error":{"code","message"}}` -
 * and that is what this reads first. But the VALIDATION layer in front of their
 * routes has its own shape, `{"detail":[{"loc":[...],"msg":"..."}]}`, and it
 * fires before any handler does. Patrick's first photo hit exactly that: the
 * body said `body.image: Field required` - the whole answer, in his hand - and
 * this function's earlier self threw it away and showed him "HTTP 422".
 *
 * That is the learning-#389 failure in a different costume: the reason existed
 * and the operator could not read it. So both shapes are understood, and the
 * status is the last resort rather than the first.
 */
function errorFrom(body: any, status: number): HostError {
  const envelope = body?.error;
  if (envelope?.message) return new HostError(status, envelope.code ?? "error", envelope.message);

  // Validation errors: one or many, each naming the field it is about.
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

/* ----------------------------------------------------------- the table -- */

type Query = Record<string, string | number | boolean | null | undefined>;

interface Route {
  path: string;
  /** GET unless a route says otherwise. Reads outnumber verbs and always will. */
  method?: "GET" | "POST";
  /** Seam arguments -> query string. Absent means the route takes none. */
  query?: (args: Record<string, unknown>) => Query;
  /** Seam arguments -> JSON body. POST only. */
  body?: (args: Record<string, unknown>) => Record<string, unknown>;
  /** Envelope -> what the seam's caller expects back, when they differ. */
  unwrap?: (body: any) => unknown;
}

/**
 * Seam verb -> `/v1` route. Every entry is a READ.
 *
 * The names on the left are `host/index.ts`'s, which are the Rust command
 * names; the paths on the right are @api's. Neither side had to move.
 */
const ROUTES: Record<string, Route> = {
  // Not a seam verb - the enrollment probe, named with a reserved prefix so it
  // can never collide with a Rust command.
  __whoami: {
    path: "/v1/whoami",
  },
  fleet_snapshot: {
    path: "/v1/fleet",
  },
  agent_roster: {
    // The roster is every project's citizens. The host API serves one project
    // per call, so the phone shows the seated project's cards and nothing else
    // until /v1 grows a roster of its own. Named here rather than faked.
    path: "/v1/fleet",
    unwrap: (body) => body?.branches ?? [],
  },
  read_file_text: {
    // NAMES, never paths - @api's fence takes a branch and a file name, and
    // there is no path parameter to abuse. The seam's single `path` argument
    // is split back into the two the fence wants.
    path: "/v1/files",
    query: (args) => splitBranchFile(String(args.path ?? "")),
    // -> FileText, the shape types.ts mirrors from the Rust struct. The field
    //    names differ on the wire (`content` vs `diff`); the seam's callers
    //    must not have to care, so the rename happens here.
    unwrap: (body) => ({
      path: `${body?.branch ?? ""}/${body?.file ?? ""}`,
      content: body?.content ?? "",
      truncated: Boolean(body?.truncated),
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
  notifications_read: {
    path: "/v1/feed",
    query: (args) => ({ since: args.since as string, limit: args.limit as number }),
    unwrap: (body) => body?.events ?? [],
  },
  // The same route, envelope kept. `notifications_read` throws the cursor away
  // because the desktop has none; the feed screen needs it, and needs `gap`
  // most of all - a window that lost events must say so rather than just look
  // shorter.
  notifications_feed: {
    path: "/v1/feed",
    query: (args) => ({ since: args.since as string, limit: args.limit as number }),
  },

  /* ------------------------------------------------------------- verbs -- */
  /* OPERATE scope. These are the only rows on this table that change anything
     on the machine, and each one names its target explicitly - no verb here
     infers what it is acting on from a seat, a default, or the last thing the
     operator looked at. */

  // No model field, by Patrick's ruling: the branch's own config decides what
  // wakes, so no vendor word appears anywhere in this contract.
  verb_wake: {
    path: "/v1/verbs/wake",
    method: "POST",
    body: (args) => ({
      branch: args.branch,
      project: args.project,
      message: args.message,
    }),
  },

  // The project is REQUIRED and travels with the branch, never inferred. A room
  // name carries its project scope; resolving it against anything else names a
  // different room and kills a session nobody asked about (key learning #22).
  verb_kill: {
    path: "/v1/verbs/kill",
    method: "POST",
    body: (args) => ({ branch: args.branch, project: args.project }),
  },

  // No target: it locks the machine the server runs on, and there is only one.
  verb_lock: {
    path: "/v1/verbs/lock",
    method: "POST",
    body: () => ({}),
  },

  // NO TERMINAL ROUTE LIVES HERE. The room is not a request/response resource:
  // it is a stream, and `openRoomSocket` below is its door. `/v1/room/pane` and
  // `/v1/verbs/keys` were routed here for one evening and are gone with the
  // repaint design they served (DPLAN-0300 Amendment 1).
};

/**
 * Verbs the phone knows the name of and cannot perform - refused with a reason
 * rather than left to fail as "unknown command".
 *
 * Splitting these out from "not in the table at all" is the point: the first is
 * a designed absence with a date on it, the second is a bug.
 */
const NOT_YET: Record<string, string> = {
  project_switch: "the phone reads the project it was pointed at; switching lands with the verb lane",
  list_dir: "the file tree needs a directory listing route - /v1 serves single files today",
  git_changes: "per-branch change counts ride the fleet card; a standalone count has no route yet",
  git_project_changes: "the project-wide count has no route yet",
  resolve_paths: "path resolution is a desktop drag-and-drop concern and has no phone gesture",
  room_kill: "the phone ends a room through verb_kill, which names its project explicitly",
  pty_create: "the phone attaches a real terminal by deep link, never a webview emulator",
  pty_write: "no webview terminal on the phone - see pty_create",
  pty_resize: "no webview terminal on the phone - see pty_create",
  pty_kill: "no webview terminal on the phone - see pty_create",
  monitor_create: "monitor panes are a desktop pane concern",
  agent_settings_read: "settings are edits - held for the verb lane",
  agent_settings_write: "settings are edits - held for the verb lane",
  baud_settings_read: "desktop-local preferences; the phone keeps its own",
  baud_settings_write: "desktop-local preferences; the phone keeps its own",
  hooks_sound_get: "desktop-local preference",
  hooks_sound_set: "desktop-local preference",
  memory_config_read: "config is an edit - held for the verb lane",
  memory_config_write: "config is an edit - held for the verb lane",
  screenshot_capture: "this captures the MACHINE's screen through its compositor - there is none to capture from a phone",
};

/* --------------------------------------------------------- the mapping -- */

/**
 * `<branch>/<file...>` -> the two arguments @api's fence takes.
 *
 * The desktop seam passes one string because the Rust side resolves it under
 * the seated project. The host API refuses paths outright and wants the branch
 * and the file named separately, so the split happens here - the one place
 * allowed to know both shapes.
 */
function splitBranchFile(path: string): Query {
  // An ABSOLUTE path is the desktop's shape and it is refused here, loudly.
  // Stripping the leading slash and splitting anyway would ask @api's fence for
  // branch "home" - a confusing refusal about a branch nobody named, instead of
  // a clear one about the shape of the request. The fence takes names; callers
  // on this transport pass `<branch>/<file>`.
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

function queryString(query: Query): string {
  const parts = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/* ------------------------------------------------------------ the call -- */

/** A typed host call. The only `fetch` in the application. */
export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const refusal = NOT_YET[command];
  if (refusal) throw new HostError(501, "not_on_the_phone", `${command}: ${refusal}`);

  const route = ROUTES[command];
  if (!route) throw new HostError(501, "unrouted", `${command} has no /v1 route - the seam grew and this table did not`);

  const token = readToken();
  if (!token) throw new HostError(401, "no_token", "no token - paste one to connect");

  const query = route.query ? route.query(args ?? {}) : {};
  const project = (args?.project as string) ?? "";
  if (project) query.project = project;

  const method = route.method ?? "GET";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  let payload: string | undefined;
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(route.body ? route.body(args ?? {}) : {});
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${route.path}${queryString(query)}`, {
      method,
      headers,
      body: payload,
    });
  } catch (cause) {
    // A network failure is NOT a rejected token, and the difference decides
    // whether the operator should re-paste or check the server.
    throw new HostError(0, "unreachable", `cannot reach the host API: ${String(cause)}`);
  }

  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => null);

  if (!response.ok) throw errorFrom(body, response.status);

  return (route.unwrap ? route.unwrap(body) : body) as T;
}

/**
 * Prove a token before the face shows anything.
 *
 * `/v1/whoami` echoes the calling token's own identity, which makes it the one
 * honest enrollment check: a token that answers here is a token the server
 * accepts, not one that merely looks well-formed.
 */
export async function verifyToken(token: string): Promise<{ id: string; label: string; scope: string }> {
  const previous = readToken();
  writeToken(token);
  try {
    return await call<{ id: string; label: string; scope: string }>("__whoami");
  } finally {
    if (previous !== token) writeToken(previous);
  }
}

/** Hand a URL to the phone's browser - `window.open` is the whole binding. */
export function openExternal(url: string): Promise<void> {
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve();
}

/**
 * The tauri event channel has no phone binding, and does not need one.
 *
 * This is the DESKTOP's pty stream - tauri events carrying pty output to a
 * window in the same process. The phone streams a room too, but over a
 * WebSocket (`openRoomSocket` below), which is a different mechanism reaching
 * the same tmux session. Exported so the seam's shape matches on both sides;
 * constructing one throws rather than pretending.
 */
export class HostChannel {
  constructor() {
    throw new HostError(501, "not_on_the_phone", "tauri event channels are desktop-only - the phone streams a room over a socket");
  }
}

/* ------------------------------------------------------------- the room -- */

/**
 * Attach a real terminal to a real room. OPERATE scope, no exception.
 *
 * THE ONE PLACE THAT KNOWS A SOCKET URL, for the same reason `call` is the one
 * place that knows an HTTP one. Everything above the seam is handed a
 * `WebSocket` and never learns where the room lives.
 *
 * ATTACH, NOT REPAINT (DPLAN-0300 Amendment 1). What comes back is the room
 * itself over a PTY running a tmux client - so scrollback, colour, cursor
 * position and full-screen programs work because nobody reimplements them.
 * The evening this lane spent polling `capture-pane` produced a picture that
 * updated; this produces the room.
 *
 * A CLOSED SOCKET IS A DETACH, never an end. @api's PTY sends SIGHUP to the
 * tmux CLIENT and nothing else; the session, the agent inside it and its
 * scrollback all survive. Ending a room stays exactly one door - `--end-room`,
 * which reaches the same `room_kill_named` the desktop's button does.
 */
/**
 * Put an image on the host's disk and learn where it landed. OPERATE scope.
 *
 * THE PATH IS THE ENTIRE PRODUCT. Nothing here holds bytes, previews anything
 * or remembers an upload - the server writes a file and answers with its
 * absolute path, and the caller types that path into a room. That is the whole
 * feature, and it is the desktop's mechanism unchanged (`screenshot.rs`: Claude
 * Code reads images by path).
 *
 * MULTIPART, so it does not go through `call`. The route table speaks JSON, and
 * teaching it a second body shape to carry one route would complicate every
 * other one. `FormData` also means the browser sets its own boundary - setting
 * `Content-Type` by hand here is the classic way to break a multipart POST.
 *
 * THE SERVER NAMES THE FILE. The phone's filename is untrusted input and is
 * sent only as a hint; @api generates the real name from a timestamp and the
 * sniffed content type. A client-named file is the traversal class their read
 * fence already exists to prevent.
 */
export async function uploadImage(file: File): Promise<string> {
  const token = readToken();
  if (!token) throw new HostError(401, "unauthorized", "no token - sign in before sending a photo");

  const form = new FormData();
  // THE FIELD NAME IS `image`, and it is pinned by @api's route, not chosen
  // here. The contract said "multipart body, one image" and never named the
  // field; they built `image`, this built `file`, and Patrick's first real
  // photo came back 422 `{'loc': ['body','image'], 'msg': 'Field required'}`.
  // Both halves were correct against a contract with a hole in it - and no
  // harness could have caught it, because a stand-in speaks the field name its
  // author already believes in. A wire detail with two spellings has to be read
  // off the other side, never inferred.
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
  // A 200 carrying no path is a failure that looks like a success, and the
  // caller would type "undefined" into a live room. Refuse it here.
  const path = typeof body === "string" ? body : (body?.path ?? null);
  if (typeof path !== "string" || !path) {
    throw new HostError(502, "no_path", "the upload succeeded but named no path - nothing to deliver");
  }
  return path;
}

export function openRoomSocket(branch: string, project: string): WebSocket {
  const token = readToken();
  if (!token) {
    throw new HostError(401, "unauthorized", "no token - sign in before attaching a room");
  }
  // Same-origin by default, exactly like `API_BASE`: a bundle @api serves needs
  // no configuration. `location.protocol` decides ws vs wss so a page served
  // over TLS never opens a cleartext socket - browsers refuse that anyway, and
  // failing at the URL is clearer than failing at the handshake.
  const base = API_BASE
    ? API_BASE.replace(/^http/, "ws")
    : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
  const query = new URLSearchParams({ branch, project });
  return new WebSocket(`${base}/v1/room/attach?${query}`, [BEARER_SENTINEL, token]);
}
