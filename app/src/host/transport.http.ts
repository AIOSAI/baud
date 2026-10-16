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

/**
 * WHERE THIS FACE IS TALKING, in one sentence a person can read.
 *
 * The settings screen shows the server it is connected to, and the only file
 * entitled to answer that is this one - "it only holds while this file stays
 * the ONLY place that knows a URL" (the header, and it still means it). A
 * screen resolving `VITE_BAUD_API ?? location.origin` for itself would be a
 * second implementation of the same rule, drifting the first time the rule
 * changes.
 *
 * The empty base is not a missing value: it is same-origin, which resolves to
 * the address the page was served from - exactly what a `fetch("/v1/...")`
 * would reach.
 */
export function apiOrigin(): string {
  return API_BASE || window.location.origin;
}

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
    // `args.project` rides the generic project lift in `call` - the phone's
    // seat is client state, passed on every read, never held by the server.
    path: "/v1/fleet",
  },
  list_projects: {
    // The switcher's rows - @baud's own census by exec, reached through @api.
    // The envelope's error became a 503 server-side; what lands here is whole.
    path: "/v1/projects",
    unwrap: (body) => body?.projects ?? [],
  },
  agent_roster: {
    // THE SYSTEM'S WORKING SET, and it must cross projects or it is a lie.
    //
    // This used to alias /v1/fleet, which serves ONE project - so the phone got
    // the seated project's cards back under a name that promises every
    // project's. Harmless while nothing asked the question; the moment the rail
    // grew cross-project wheels it became a wheel that looks full and is wrong.
    // Repointed at @baud's own sweep by exec, the same lane /v1/projects
    // already uses: `baud --roster`, one process and one ranking behind both
    // faces. Until @api lands the route this 404s, and the wheels say so - a
    // refusal beats a half-true fleet.
    path: "/v1/roster",
    unwrap: (body) => body?.branches ?? [],
  },
  machine_vitals: {
    // THE MACHINE'S VITALS (FPLAN-0561 row 3). @skills owns the reading and its
    // meaning, @api proxies it verbatim, this face draws it - so the body IS the
    // reading and there is nothing to unwrap. NO QUERY, EVER: the route answers
    // any parameter with 400 machine_parameters_refused, a cache-buster
    // included, and it needs none - the server caches 1 s single-flight. A
    // refusal (psutil_missing, switched_off) is a 503 carrying the owner's
    // sentence as error.message, which `errorFrom` already hands through.
    path: "/v1/machine",
  },
  lock_state: {
    // THE LOCK'S POSITION (FPLAN-0585 row 3), beside the machine read and the
    // same shape: @skills reads it, @api relays the dict verbatim, the header
    // chip draws it. Read scope - locking stays verb_lock, under operate. NO
    // QUERY, EVER: any parameter is a 400, and the server caches 1 s
    // single-flight. `ok: false` ("could not tell") is a 200 carrying the
    // skill's sentence; only a door that broke is a 503 lock_door_failed.
    path: "/v1/lock",
  },
  /* --------------------------------------------------------- the roots -- */
  /* FPLAN-0443. The fence learned four kinds of word instead of one, and these
     three entries are the WHOLE of what this face knows about that on the wire.
     Deliberately: a root travels as one key beside arguments these two routes
     already sent, so a correction from @api is this block and nothing else.

     `root` NAMES THE KIND; the first component of the seam's `path` names the
     thing WITHIN that kind, which is where a branch name already sat. So the
     splitter below, the browser, its up-chip and the Reader all keep working
     with no change - the only new thing anywhere is the kind, and it rides as
     a key that is absent unless a caller named one. Absent is the branch
     meaning these routes have always had, character for character. */
  list_roots: {
    // The roster the picker renders. A face that hardcoded this list would be
    // a face that lies the day a project is added.
    path: "/v1/roots",
    unwrap: (body) => (Array.isArray(body?.roots) ? body.roots : []),
  },
  list_dir_window: {
    // One level of a branch's tree, fenced on names. The seam's `path` is
    // `<branch>` or `<branch>/<subdir>`; entry paths come back RELATIVE to
    // the branch root, ready to feed straight back in or into a file read.
    path: "/v1/dir",
    query: (args) => {
      const split = splitBranchFile(String(args.path ?? ""));
      return { branch: split.branch, dir: split.file, root: args.root as string };
    },
    unwrap: (body) => ({
      entries: body?.entries ?? [],
      truncated: Boolean(body?.truncated),
      floor: floorOf(body),
    }),
  },
  read_file_text: {
    // NAMES, never paths - @api's fence takes a branch and a file name, and
    // there is no path parameter to abuse. The seam's single `path` argument
    // is split back into the two the fence wants.
    path: "/v1/files",
    query: (args) => ({ ...splitBranchFile(String(args.path ?? "")), root: args.root as string }),
    // -> FileText, the shape types.ts mirrors from the Rust struct. The field
    //    names differ on the wire (`content` vs `diff`); the seam's callers
    //    must not have to care, so the rename happens here.
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
  /**
   * @api MATCHED THE SEMANTICS, NOT ONLY THE SHAPE, and that is the whole
   * reason this can share `GitChanges` with the desktop: they read lib.rs and
   * answered with tracked files only, branch-local paths, `git diff HEAD`
   * relative. So the two faces cannot disagree about the same branch at the
   * same moment, which a re-implementation would have guaranteed they
   * eventually would.
   *
   * `untracked` arrives too and is DELIBERATELY DROPPED. It is real and it is
   * additive, and rendering it here would make the phone's GIT tile mean
   * something the desktop's does not - the exact divergence the matched
   * semantics exist to prevent. It belongs on both faces or neither, and the
   * desktop is frozen.
   *
   * The argument is a branch NAME on this transport, never `branch.path`: an
   * absolute path is refused by `splitBranchFile` on purpose.
   */
  git_changes: {
    path: "/v1/git-changes",
    // `grain` rides through untouched when a caller names one. Absent is the
    // branch's own subtree, which is the server's default and every existing
    // caller's meaning - so the request this route builds for the card, the
    // badge sweep and the files screen is character-for-character what it was.
    query: (args) => ({
      branch: branchOf(String(args.path ?? "")),
      grain: args.grain as string,
    }),
    unwrap: (body) => ({
      files: Array.isArray(body?.files) ? body.files.map(String) : [],
      count: Number(body?.count ?? 0),
    }),
  },

  /* ----------------------------------------------------------- git app -- */
  /* DPLAN-0303. The same two routes as above plus two more, asked WHOLE: the
     envelope is the answer here, not a number lifted out of it.

     NOTHING IS PRE-REFUSED IN THIS TABLE. The lanes have their own rules -
     a limit outside 1..50, a ref with a grain, a file the patch does not touch -
     and every one of them is answered by @api in a sentence written for a
     person. A guard here would replace those sentences with BAUD's guess at
     them, which is the one thing the error envelope exists to prevent. */

  git_change_count: {
    // THE SAME ROUTE, ANSWERED AS TWO NUMBERS (DPLAN-0305). The rows and the
    // file names still arrive - a count-only parameter is @api's to add and
    // this face does not wait on it - but nothing here builds an array out of
    // them for a caller that only reads a length. Two pollers use this, and
    // between them they ask about thirteen times a minute for the life of the
    // app.
    path: "/v1/git-changes",
    query: (args) => ({ branch: args.branch as string, grain: args.grain as string }),
    unwrap: (body) => ({
      count: Number(body?.count ?? 0),
      untracked: Number(body?.untracked ?? 0),
    }),
  },
  git_change_rows: {
    path: "/v1/git-changes",
    // A branch NAME, never a path: these callers are phone screens and there is
    // no desktop shape to split. `project` rides the generic lift in `call`.
    query: (args) => ({ branch: args.branch as string, grain: args.grain as string }),
    // The envelope kept whole, with the two collections defended. A field that
    // arrived as something other than a list is a lane that changed shape, and
    // an empty list renders as "nothing changed" rather than throwing inside a
    // map three components away.
    unwrap: (body) => ({
      branch: String(body?.branch ?? ""),
      grain: String(body?.grain ?? ""),
      files: Array.isArray(body?.files) ? body.files.map(String) : [],
      count: Number(body?.count ?? 0),
      untracked: Number(body?.untracked ?? 0),
      rows: Array.isArray(body?.rows)
        ? body.rows.map((row: any) => ({ path: String(row?.path ?? ""), status: String(row?.status ?? "") }))
        : [],
    }),
  },
  git_file_diff: {
    path: "/v1/diff",
    // `staged` is deliberately never sent. The app reads what is in the tree or
    // what is in a commit; a staged/unstaged split is a desk concern, and the
    // parameter refuses outright beside a ref.
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
    // The envelope WHOLE, and it has to be: the browsable form and the
    // configured URL are two different answers, and a face that only got one of
    // them would either lose the fact or invent a page for a directory. No
    // unwrap here builds a link out of them either - the server already dropped
    // the clone suffix and turned ssh into https, so anything this table did to
    // `web` would be a second implementation of a rule that already ran.
    path: "/v1/git-remote",
    query: (args) => ({ branch: args.branch as string }),
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

  /* ------------------------------------------------------------ backup -- */
  /* DPLAN-0411; shapes in devpulse/docs.local/backup_door_contract.md. Run is
     OPERATE scope, job and status are read. `call` already puts a non-empty
     `project` on the query string, which is exactly where status wants it;
     run carries it in the body as the contract names it. */

  backup_run: {
    path: "/v1/backup/run",
    method: "POST",
    body: (args) => ({ project: args.project, lane: args.lane }),
  },
  backup_job: {
    path: "/v1/backup/job",
    query: (args) => ({ id: args.id as string }),
  },
  // sizes=1 or nothing at all: an absent key is the cheap read, and `queryString`
  // drops undefined, so the walk is only ever asked for by name.
  backup_status: {
    path: "/v1/backup/status",
    query: (args) => ({ sizes: args.sizes ? 1 : undefined }),
  },
  // DPLAN-0412. Operate scope, like run, and the same body: `lane` is the verb
  // that was pressed, never the sub-lane a progress line names.
  backup_cancel: {
    path: "/v1/backup/cancel",
    method: "POST",
    body: (args) => ({ project: args.project, lane: args.lane }),
  },

  /* ---------------------------------------------------------- settings -- */
  /* The desktop's two gears, reached over /v1. Reads ride the read scope,
     writes are operate. The patch shapes cross the wire UNTOUCHED because
     JSON.stringify keeps null and drops undefined - which IS the three-state
     contract, so no body mapper may "clean" a patch here. */

  agent_settings_read: {
    path: "/v1/agent-settings",
    query: (args) => ({ branch: String(args.agent ?? "") }),
  },
  agent_settings_write: {
    path: "/v1/agent-settings",
    method: "POST",
    body: (args) => ({ branch: args.agent, patch: args.patch }),
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

  /* ----------------------------------------------------- memory limits -- */
  /* LIVE as of this round - re-probed from here before these lines were
     written: the four routes answer 401 unauthenticated where they answered
     404 yesterday, and a nonsense path still answers 404, so the distinction
     holds in both directions rather than only in the one that flatters the
     change.

     @api's envelope is NOT this seam's MemoryConfig, so the translation lives
     here, which is the one place allowed to know both shapes. Two things the
     envelope genuinely does not carry, and neither is invented below:
     character caps (there is no route for them - the desktop gear keeps that
     lane) and the rollover GROUP each dial belongs to. */

  memory_config_read: {
    path: "/v1/memory-config",
    // No branch: the FLEET view. `defaults` plus `overrides` is exactly what a
    // MemoryConfig's `rollover` plus `per_branch` is, which is why the
    // per-agent panel can share one component across both faces.
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
  /* THE FOUR MEMORY-CONFIG ROUTES LEFT THIS TABLE - they are live now, and the
     move was re-measured from here rather than taken on report: 401
     unauthenticated where they answered 404 before, with a nonsense path still
     answering 404 in the same sweep. They sit in the route table above.

     `memory_config_write` STAYS REFUSED, and not by oversight. It is the
     direct file write for entry CHARACTER caps, and there is no host route for
     those - @api serves the rollover lane only. A verb with no route belongs
     here with its reason, not bound to the nearest plausible path. */
  memory_config_write:
    "entry character caps have no /v1 route - only the rollover limits are served here, and the desktop gear owns the caps",
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
/**
 * The absolute path of the root an answer stands on (FPLAN-0443 rider).
 *
 * ONE READER FOR ONE KEY, and that is the whole reason it is a function rather
 * than two inline reads. `floor` is a contract agreed with @api while both
 * sides were being built in parallel; if what ships on the wire is spelled
 * differently, this line is the correction and there is no second place for the
 * name to hide. The same shape the roots round took, for the same reason.
 *
 * An absent key answers "" rather than undefined - the callers compose with it,
 * and "" is the value that makes composition refuse instead of building half a
 * path.
 *
 * Args:
 *   body: The parsed answer body.
 *
 * Returns:
 *   The machine path of the resolved root, or "" when the server did not say.
 */
function floorOf(body: any): string {
  return typeof body?.floor === "string" ? body.floor : "";
}

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

/**
 * Which `.trinity/` file a rollover entry type lives in.
 *
 * @api's envelope names the entry TYPE and not the group, while this seam's
 * `RolloverDial` is identified by both - a patch names group and key together.
 * The mapping is not guessed: it is @memory's own ENTRY TYPES table, printed
 * by `drone @memory config --help`, which states sessions and key_learnings
 * live in local.json and observations in observations.json.
 *
 * A type nobody here has heard of keeps its own name as its group rather than
 * being forced into one of the two. It will not match an override and will not
 * pretend to - which is the honest failure, and visible.
 */
const ROLLOVER_GROUPS: Record<string, string> = {
  sessions: "local",
  key_learnings: "local",
  observations: "observations",
};

function groupOf(entryType: string): string {
  return ROLLOVER_GROUPS[entryType] ?? entryType;
}

/**
 * A write answered 200 but refused - the phone's copy of the exit-code hazard.
 *
 * @memory's verbs exit ZERO when they refuse, and @api faithfully passes that
 * through as `{ok: false, detail: "<@memory's sentence>"}` with an HTTP 200.
 * So a transport that trusted the status code would report a refused write as
 * a save and leave a number on screen that was never written. The sentence is
 * @memory's own and is thrown unreworded.
 */
/**
 * A refusal that arrived with a SUCCESS status, which is the only kind this can
 * still catch - and measuring that is what corrected my own report of it.
 *
 * @memory refuses in-band (prints a sentence, exits zero), so I reported that
 * @api's new `suggestion` field was being dropped here. It is not: their
 * refusals come back as HTTP 400 and never reach an `unwrap` at all, and their
 * handler JOINS the suggestion onto the message before sending it ("... — Try:
 * <remedy>"), so `errorFrom` already surfaces the whole sentence verbatim.
 * Wiring it a second time would have printed the remedy twice.
 *
 * What was genuinely wrong is right here and was never reachable enough to
 * notice: this branch read `body.detail`, which is FastAPI's validation shape,
 * while @api's envelope is `error.message`. A 200-carrying-a-refusal would have
 * been reported as "refused, without saying why" while the reason sat one field
 * away. Same fields as `errorFrom` now, suggestion included, so if that door
 * ever opens it speaks.
 */
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

/**
 * @api's fleet envelope -> this seam's `MemoryConfig`.
 *
 * Two fields are left deliberately empty rather than filled with a plausible
 * value, because nothing on this route reports them: `entry_limits` (the
 * character caps have no host route at all - the desktop gear owns that lane)
 * and `enforced`, which is a claim about the enforcement hook that this
 * envelope makes no statement about. `path` names the ROUTE the numbers came
 * from, which is true, rather than a file path this face never touched.
 */
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
    path: "/v1/memory-config",
    enforced: false,
    entry_limits: [],
    rollover,
    per_branch,
  };
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

/**
 * Trade a pairing code for a bearer (DPLAN-0406; contract
 * devpulse/docs.local/contract_pairing_door_2026-10-13.md).
 *
 * `POST /v1/pair` is the one route without a bearer, so this is a fetch of its
 * own rather than a `call`: `call` refuses before the wire when no token is
 * held, which is exactly the state a pairing phone is in. Its failures keep
 * the door's two apart like every other fetch here: nothing answered is
 * `unreachable`; an answer is the server's own words through `errorFrom`, a
 * 401 for a code that is unknown, expired or used (one answer for all three),
 * a 429 for too many tries.
 */
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
  // A 200 with no token is a failure that looks like a success: the code is
  // spent and nothing could be stored. Say so rather than open on nothing.
  if (typeof body?.token !== "string" || !body.token) {
    throw new HostError(502, "no_token", "the pairing answered but carried no token - pair again");
  }
  return body;
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

export function openRoomSocket(branch: string, project: string, kind = ""): WebSocket {
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
  // `kind=shell` asks for an EMPTY terminal instead of the agent's room -
  // absent entirely for agent attaches, so that handshake stays byte-identical
  // to what it was before shells existed.
  if (kind) query.set("kind", kind);
  return new WebSocket(`${base}/v1/room/attach?${query}`, [BEARER_SENTINEL, token]);
}
