/** Which door a card offers and what a door types, ported from the desktop's own rules. Reference: docs/phone/room.md */

import type { BranchStatus } from "../../types";

export type LaunchMode = "resume" | "fresh";

export { helpCommand } from "../../desktop/InquiryPane";

// Help is not a fourth mode but a shell with one line typed; a mode would let `?` type into a live claude's room.
export type PhoneMode = LaunchMode | "shell" | "watch";

const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

/** A live session in this branch, BAUD's or an outside one: the door is attach, never a second claude. */
export const isAttached = (branch: BranchStatus): boolean =>
  (branch.has_room || branch.outside_room !== null) && branch.interactive;

export const canResume = (branch: BranchStatus): boolean =>
  branch.has_history || branch.resume_id !== null;

/** The guard: type the command line only at a prompt, since bytes sent into a live claude become chat. */
export const typeOnAttach = (branch: BranchStatus): boolean => !branch.interactive;

/** The agent CLI and its resume form, by the card's provider: id before `-c`; codex resumes by subcommand, opencode by `--session`. */
export function agentCommand(branch: BranchStatus, resume: boolean): string {
  if (branch.provider === "opencode") {
    // A pane's shell is no login shell, so the installer's bin is not on PATH; `--standalone` keeps this pane's env off the shared server.
    const session = resume && branch.resume_id ? ` --session ${quote(branch.resume_id)}` : "";
    return `PATH="$HOME/.opencode/bin:$PATH" command opencode --standalone --auto${session}`;
  }
  if (branch.provider === "codex") {
    const thread = resume && branch.resume_id ? ` resume ${quote(branch.resume_id)}` : "";
    return `command codex --dangerously-bypass-approvals-and-sandbox${thread}`;
  }
  const flag = !resume
    ? ""
    : branch.resume_id
      ? ` --resume ${quote(branch.resume_id)}`
      : branch.has_history
        ? " -c"
        : "";
  return `command claude --permission-mode bypassPermissions${flag}`;
}

/** A ritual chip's spelling in the room's CLI: Codex has no custom slash commands, its rituals are `$` skills; OpenCode spells Claude's. */
export const slashCommand = (cmd: string, provider?: BranchStatus["provider"]): string =>
  provider === "codex" && cmd !== "/compact" ? `$${cmd.slice(1)}` : cmd;

/** The switch legs a room offers: the other two CLIs, each spelled as the room's CLI calls it. */
export const switchLegs = (provider?: BranchStatus["provider"]): string[] =>
  provider === "codex" ? ["$claude", "$opencode"] : provider === "opencode" ? ["/claude", "/codex"] : ["/codex", "/opencode"];

const HOSTS = { claude: "Claude", codex: "Codex", opencode: "OpenCode" } as const;

/** The card's chip, `Host · model`: the observed model, else the requested one (or "default") with a trailing `?`, never styled as observed. */
export function runChip(branch: BranchStatus): { text: string; pending: boolean; title: string } {
  const provider = branch.provider ?? "claude";
  const host = HOSTS[provider];
  // A live process on another host makes the pointer history: its model is not this session's.
  const run = branch.run && (!branch.run.host_cli || branch.run.host_cli === provider) ? branch.run : null;
  if (run && run.model_observed !== "pending") {
    return { text: `${host} · ${run.model_observed}`, pending: false, title: `${host}, running ${run.model_observed}` };
  }
  const asked = run && run.model_requested !== "cli_default" ? run.model_requested : "default";
  const what = asked === "default" ? "the CLI's default model" : `requested ${asked}`;
  return { text: `${host} · ${asked}?`, pending: true, title: `${host}, ${what} — not yet observed` };
}

/** The live session each non-claude card's doors act on, own room first, mapped to its CLI. */
export const roomProviders = (branches: BranchStatus[]): Record<string, BranchStatus["provider"]> =>
  Object.fromEntries(
    branches.flatMap((branch) => {
      const session = branch.own_room_live ? branch.room : branch.outside_room;
      return branch.provider && branch.provider !== "claude" && session ? [[session, branch.provider]] : [];
    }),
  );

/** The one command line a door types, on both faces. */
export function launchCommand(branch: BranchStatus, mode: LaunchMode): string {
  // Dispatched resume stops the agent first: two agents on one session id kill the job silently; `sleep 2` lets it release.
  if (mode === "resume" && branch.dispatched && branch.resume_id) {
    return (
      `cd ${quote(branch.path)} && drone @hooks sessions reclaim @${branch.name}` +
      ` && sleep 2 && ${agentCommand(branch, true)}`
    );
  }
  return `cd ${quote(branch.path)} && ${agentCommand(branch, mode === "resume")}`;
}

export interface RoomDoor {
  mode: LaunchMode;
  label: string;
  title: string;
  intercept?: true;
}

/** The doors this card offers; a live room returns exactly one, so it is never offered a resume. */
export function roomDoors(branch: BranchStatus): RoomDoor[] {
  if (isAttached(branch)) {
    return [
      {
        mode: "resume",
        label: "▸ attach",
        title: branch.outside_room
          ? `attach to '${branch.outside_room}' - the live session in this branch, which BAUD did not create`
          : "attach to the live session in this room",
      },
    ];
  }
  const doors: RoomDoor[] = [];
  if (canResume(branch) && branch.dispatched && branch.resume_id) {
    doors.push({
      mode: "resume",
      label: "▸ resume ⚡",
      title:
        "INTERCEPT: stop the working agent, then continue in its chat - the job ends, the conversation survives",
      intercept: true,
    });
  } else if (canResume(branch) && !branch.dispatched) {
    doors.push({
      mode: "resume",
      label: "▸ resume",
      title: branch.resume_id
        ? "attach and resume this branch's recorded session"
        : "attach and continue this branch's last conversation",
    });
  }
  doors.push({
    mode: "fresh",
    label: "▸ fresh",
    title: "attach and start a new conversation in this room",
  });
  return doors;
}
