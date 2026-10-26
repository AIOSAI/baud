/** Which door a card offers and what a door types, ported from the desktop's own rules. Reference: docs/phone/room.md */

import type { LaunchMode } from "../../desktop/BranchChip";
import type { BranchStatus } from "../../types";

export type { LaunchMode };

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

/** The agent CLI and its resume form, by the card's provider: id before `-c`; codex resumes by subcommand and has no `-c`. */
export function agentCommand(branch: BranchStatus, resume: boolean): string {
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

/** A ritual chip's spelling in the room's CLI: Codex has no custom slash commands, its rituals are `$` skills. */
export const slashCommand = (cmd: string, provider?: BranchStatus["provider"]): string =>
  provider === "codex" && cmd !== "/compact" ? `$${cmd.slice(1)}` : cmd;

export const codexSessions = (branches: BranchStatus[]): string[] =>
  branches.flatMap((branch) => {
    const session = branch.own_room_live ? branch.room : branch.outside_room;
    return branch.provider === "codex" && session ? [session] : [];
  });

/** The one command line a door types; App.tsx types the same `agentCommand`. */
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
