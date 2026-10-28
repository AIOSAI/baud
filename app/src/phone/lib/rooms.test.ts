/** Tests for app/src/phone/lib/rooms.ts: the command line a door types, by provider and mode, and the ritual chips. */

// Not tested here: the one-line guards isAttached, canResume and typeOnAttach (unpinned).

import { describe, expect, it } from "vitest";

import type { BranchStatus } from "../../types";
import { agentCommand, launchCommand, roomDoors, roomProviders, slashCommand, switchLegs } from "./rooms";

const PATH = "/home/op/Projects/AIPass/src/aipass/canary";
const THREAD = "01a1748b-7c02-78d0-bb32-8d5f593ce962";
const OC_SESSION = "ses_e7e3415cbffef1y2cc4IHRRmXX";
const OPENCODE = `PATH="$HOME/.opencode/bin:$PATH" command opencode --standalone --auto`;

function card(fields: Partial<BranchStatus>): BranchStatus {
  return {
    name: "canary",
    path: PATH,
    project: "AIPASS",
    is_citizen: true,
    manager: false,
    citizen_class: "citizen",
    dispatched: false,
    interactive: false,
    has_history: false,
    resume_id: null,
    provider: "claude",
    room: "baud-canary",
    has_room: false,
    own_room_live: false,
    outside_room: null,
    subagents: 0,
    new_mail: 0,
    opened_mail: 0,
    active_plans: 0,
    todo_count: 0,
    summary: "",
    last_updated: "",
    ...fields,
  };
}

describe("a codex card's doors", () => {
  it("resumes its thread by the resume subcommand, after the flag", () => {
    expect(launchCommand(card({ provider: "codex", resume_id: THREAD }), "resume")).toBe(
      `cd '${PATH}' && command codex --dangerously-bypass-approvals-and-sandbox resume '${THREAD}'`,
    );
  });

  it("starts fresh with no resume subcommand, even when a thread is known", () => {
    expect(launchCommand(card({ provider: "codex", resume_id: THREAD }), "fresh")).toBe(
      `cd '${PATH}' && command codex --dangerously-bypass-approvals-and-sandbox`,
    );
  });

  it("resumes fresh when it has no thread, never with claude's -c", () => {
    expect(launchCommand(card({ provider: "codex", has_history: true }), "resume")).toBe(
      `cd '${PATH}' && command codex --dangerously-bypass-approvals-and-sandbox`,
    );
  });

  it("reclaims a dispatched session before resuming its thread", () => {
    expect(launchCommand(card({ provider: "codex", resume_id: THREAD, dispatched: true }), "resume")).toBe(
      `cd '${PATH}' && drone @hooks sessions reclaim @canary && sleep 2 && ` +
        `command codex --dangerously-bypass-approvals-and-sandbox resume '${THREAD}'`,
    );
  });
});

describe("an opencode card's doors", () => {
  it("resumes its session by --session, on the installer's bin, standalone", () => {
    expect(launchCommand(card({ provider: "opencode", resume_id: OC_SESSION }), "resume")).toBe(
      `cd '${PATH}' && ${OPENCODE} --session '${OC_SESSION}'`,
    );
  });

  it("starts fresh with no --session, and never with claude's -c", () => {
    expect(launchCommand(card({ provider: "opencode", resume_id: OC_SESSION }), "fresh")).toBe(`cd '${PATH}' && ${OPENCODE}`);
    expect(launchCommand(card({ provider: "opencode", has_history: true }), "resume")).toBe(`cd '${PATH}' && ${OPENCODE}`);
  });

  it("reclaims a dispatched session before resuming it", () => {
    expect(launchCommand(card({ provider: "opencode", resume_id: OC_SESSION, dispatched: true }), "resume")).toBe(
      `cd '${PATH}' && drone @hooks sessions reclaim @canary && sleep 2 && ${OPENCODE} --session '${OC_SESSION}'`,
    );
  });
});

describe("a claude card's doors", () => {
  it("resumes by id before -c", () => {
    expect(launchCommand(card({ resume_id: THREAD, has_history: true }), "resume")).toBe(
      `cd '${PATH}' && command claude --permission-mode bypassPermissions --resume '${THREAD}'`,
    );
  });

  it("continues with -c when it has interactive history and no id", () => {
    expect(launchCommand(card({ has_history: true }), "resume")).toBe(
      `cd '${PATH}' && command claude --permission-mode bypassPermissions -c`,
    );
  });

  it("starts fresh with no resume flag", () => {
    expect(launchCommand(card({ resume_id: THREAD, has_history: true }), "fresh")).toBe(
      `cd '${PATH}' && command claude --permission-mode bypassPermissions`,
    );
  });

  it("reclaims a dispatched session before resuming by id", () => {
    expect(launchCommand(card({ resume_id: THREAD, dispatched: true }), "resume")).toBe(
      `cd '${PATH}' && drone @hooks sessions reclaim @canary && sleep 2 && ` +
        `command claude --permission-mode bypassPermissions --resume '${THREAD}'`,
    );
  });

  it("is the claude line when an older baud-cli sends no provider", () => {
    expect(agentCommand(card({ provider: undefined, resume_id: THREAD }), true)).toBe(
      `command claude --permission-mode bypassPermissions --resume '${THREAD}'`,
    );
  });
});

describe("a dispatched card's doors, on both faces", () => {
  it("offers the two-tap intercept with a resume id, never a watch-only door", () => {
    const doors = roomDoors(card({ dispatched: true, resume_id: THREAD }));
    expect(doors.map((door) => [door.label, door.mode, door.intercept ?? false])).toEqual([
      ["▸ resume ⚡", "resume", true],
      ["▸ fresh", "fresh", false],
    ]);
  });

  it("offers only fresh without one", () => {
    expect(roomDoors(card({ dispatched: true, has_history: true })).map((door) => door.label)).toEqual(["▸ fresh"]);
  });
});

describe("quoting", () => {
  it("closes, escapes and reopens a single quote in the path and the id", () => {
    expect(launchCommand(card({ provider: "codex", path: "/x/it's", resume_id: "a'b" }), "resume")).toBe(
      `cd '/x/it'\\''s' && command codex --dangerously-bypass-approvals-and-sandbox resume 'a'\\''b'`,
    );
  });
});

describe("the ritual chips", () => {
  it("type $memo and $prep in a codex room and keep /compact", () => {
    expect(["/memo", "/prep", "/compact"].map((cmd) => slashCommand(cmd, "codex"))).toEqual(["$memo", "$prep", "/compact"]);
  });

  it("type the slash commands unchanged in a claude room or with no provider", () => {
    for (const provider of ["claude", undefined] as const) {
      expect(["/memo", "/prep", "/compact"].map((cmd) => slashCommand(cmd, provider))).toEqual(["/memo", "/prep", "/compact"]);
    }
  });

  it("type the claude spelling in an opencode room, whose commands live in .opencode/commands", () => {
    expect(["/memo", "/prep", "/compact"].map((cmd) => slashCommand(cmd, "opencode"))).toEqual(["/memo", "/prep", "/compact"]);
  });

  it("know a non-claude room by the session its doors act on, own room first", () => {
    const branches = [
      card({ name: "canary", provider: "codex", own_room_live: true, room: "baud-canary", outside_room: null }),
      card({ name: "hooks", provider: "codex", room: "baud-hooks", outside_room: "canary-switch" }),
      card({ name: "flow", provider: "claude", own_room_live: true, room: "baud-flow" }),
      card({ name: "idle", provider: "codex", room: "baud-idle" }),
      card({ name: "seed", provider: "opencode", own_room_live: true, room: "baud-seed" }),
    ];
    expect(roomProviders(branches)).toEqual({ "baud-canary": "codex", "canary-switch": "codex", "baud-seed": "opencode" });
  });
});

describe("the switch dropdown", () => {
  it("offers the other two CLIs, spelled as the room's CLI calls them", () => {
    expect(switchLegs("claude")).toEqual(["/codex", "/opencode"]);
    expect(switchLegs(undefined)).toEqual(["/codex", "/opencode"]);
    expect(switchLegs("codex")).toEqual(["$claude", "$opencode"]);
    expect(switchLegs("opencode")).toEqual(["/claude", "/codex"]);
  });
});
