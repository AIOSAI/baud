import { describe, expect, it } from "vitest";

import lib from "../../src-tauri/src/lib.rs?raw";
import { IPC_COMMANDS, routeOf } from "./route";

describe("routeOf", () => {
  it("sends a desktop-shaped read to the window's own command", () => {
    expect(routeOf("read_file_text", { path: "/home/op/AIPass/src/aipass/devpulse/README.md" })).toBe("ipc");
    expect(routeOf("fleet_snapshot")).toBe("ipc");
    expect(routeOf("fleet_snapshot", {})).toBe("ipc");
    expect(routeOf("agent_settings_read", { agent: "devpulse" })).toBe("ipc");
  });

  it("sends a phone screen's named read, with its project, over the relay", () => {
    expect(routeOf("read_file_text", { path: "devpulse/.ai_mail.local/inbox.json", project: "AIPASS" })).toBe("http");
    expect(routeOf("read_file_text", { path: "devpulse/README.md" })).toBe("http");
    expect(routeOf("read_file_text", { path: "notes.md", root: "home" })).toBe("http");
    expect(routeOf("git_changes", { path: "devpulse", project: "BAUD" })).toBe("http");
    expect(routeOf("fleet_snapshot", { project: "BAUD" })).toBe("http");
  });

  it("sends the phone-only lanes over the relay", () => {
    for (const command of ["machine_vitals", "verb_new_project", "git_log", "backup_status", "list_roots", "notifications_feed", "verb_lock"]) {
      expect(routeOf(command, {})).toBe("http");
    }
  });

  it("keeps the seat, the pty and the rooms on IPC even when they name a project", () => {
    expect(routeOf("room_kill", { branchName: "devpulse", project: "BAUD" })).toBe("ipc");
    expect(routeOf("pty_create", { cwd: "/x", project: "BAUD" })).toBe("ipc");
    expect(routeOf("list_dir", { path: "src" })).toBe("ipc");
    expect(routeOf("memory_config_write", { patch: {} })).toBe("ipc");
  });

  it("knows exactly the commands lib.rs registers, plus the relay", () => {
    const block = lib.slice(lib.indexOf("generate_handler!["), lib.indexOf("])", lib.indexOf("generate_handler![")));
    const registered = [...block.matchAll(/\w+::(\w+)/g)].map((m) => m[1]).sort();
    expect(registered).toEqual([...IPC_COMMANDS, "host_api_call"].sort());
  });
});
