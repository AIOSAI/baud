/** Tests for app/src/phone/lib/rooms.ts: the command line a door types, by provider and mode, and the ritual chips. */

// Not tested here: roomDoors (one case, a newborn card's fresh door, in newProject.test.ts) and the
// one-line guards isAttached, canResume and typeOnAttach (unpinned).

import { describe, expect, it } from "vitest";

import type { BranchStatus } from "../../types";
import { agentCommand, codexSessions, launchCommand, slashCommand } from "./rooms";

const PATH = "/home/op/Projects/AIPass/src/aipass/canary";
const THREAD = "01a1748b-7c02-78d0-bb32-8d5f593ce962";

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

  it("know a codex room by the session its doors act on, own room first", () => {
    const branches = [
      card({ name: "canary", provider: "codex", own_room_live: true, room: "baud-canary", outside_room: null }),
      card({ name: "hooks", provider: "codex", room: "baud-hooks", outside_room: "canary-switch" }),
      card({ name: "flow", provider: "claude", own_room_live: true, room: "baud-flow" }),
      card({ name: "idle", provider: "codex", room: "baud-idle" }),
    ];
    expect(codexSessions(branches)).toEqual(["baud-canary", "canary-switch"]);
  });
});
