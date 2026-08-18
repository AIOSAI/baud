/**
 * Which door a card offers, and what gets typed once it opens.
 *
 * PORTED, NOT RE-SOLVED (DPLAN-0300 Amendment 2, aimed at this branch by name).
 * Every rule below already exists on the desktop and is quoted back to its
 * line. The phone gets the desktop set - fresh, resume, attach - because a
 * launch IS an attach: since m6 the desktop's "launch" runs a tmux client into
 * the branch room and types a command line into it. Nothing here is a new
 * mechanism; it is the same judgment reading the same card.
 *
 * THE HAZARD THIS FILE EXISTS TO CARRY: a card that offers "resume" on a room
 * that already has a live claude starts a SECOND claude in that room
 * (BranchChip.tsx:332). It is not hypothetical - it shipped once, and m12 fixed
 * it by making a live room offer exactly one door. Re-deriving that judgment on
 * the phone would be re-earning the bug.
 */

import type { LaunchMode } from "../components/BranchChip";
import type { BranchStatus } from "../types";

export type { LaunchMode };

/**
 * THE HELP LINE - the desktop's own function, imported rather than retyped
 * (`InquiryPane.tsx:51`). The card's `?` sends it; nothing else does.
 *
 * IMPORTED, NOT PORTED, and that is the one place this file breaks its own
 * quote-it-back habit - deliberately, because the rule inside it is a FACT
 * about the ecosystem rather than a judgment about a card: `aipass` is the
 * user's front-door CLI with its own binary, so drone cannot resolve @aipass
 * and its card must ask the binary itself. A second copy of that exception is
 * a second thing to remember the day a second exception appears, and the two
 * faces would then disagree about what one card's `?` runs.
 */
export { helpCommand } from "../components/InquiryPane";

/**
 * What the phone's terminal region can hold: one of the desktop's launch modes,
 * an EMPTY shell — the desktop's per-card and header terminal buttons — or a
 * WATCH, the desktop card's read-only monitor pane. A shell never launches an
 * agent; `launchCommand` never sees it, and the type system is what keeps that
 * true (`launchCommand` still takes only `LaunchMode`). A watch never reaches
 * TerminalSheet at all — it renders MonitorSheet, which has no keyboard to
 * type with in the first place.
 *
 * HELP IS NOT A FOURTH MODE, and that is a decision worth stating. The card's
 * `?` opens the SAME shell room this list already names and hands it one
 * command line, exactly as the desk hands `InquiryPane` its `command` prop
 * (`InquiryPane.tsx:40`) - and the desk's own help pane is a shell too, with a
 * line typed into it. Making it a mode would put the phrase "help is really a
 * shell" in four more places (`paneKey`, `isSeat`, `paneLabel`, the socket's
 * `kind`), and the day one of them forgot it, `?` would attach the AGENT's room
 * and type a command line into a live claude's message box. The wire agrees:
 * @api's attach lane knows `shell` and `watch` and refuses every other kind by
 * name (`server.py:1018`), so a `kind=help` could not exist even if this file
 * invented one.
 */
export type PhoneMode = LaunchMode | "shell" | "watch";

/** Single-quote for the shell, exactly as `App.tsx` does - odd paths survive. */
const quote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

/**
 * One live session in this branch, whoever made it - BAUD's own room or an
 * outside one (BranchChip.tsx:155). Either way the door is attach, never a
 * second claude in the same branch.
 */
export const isAttached = (branch: BranchStatus): boolean =>
  (branch.has_room || branch.outside_room !== null) && branch.interactive;

/**
 * Two ways back into a conversation (BranchChip.tsx:160): `-c` for interactive
 * history, `--resume <id>` for a branch whose only transcripts are headless
 * dispatch runs. Either one earns a resume button.
 */
export const canResume = (branch: BranchStatus): boolean =>
  branch.has_history || branch.resume_id !== null;

/**
 * THE GUARD. Type the command line only where it can land at a PROMPT.
 *
 * `App.tsx:373` calls this `typeIfAttached` and computes it identically. A room
 * with a live claude in it has no prompt - it has claude's message box - so
 * bytes sent there become a chat message, and a `command claude` line typed
 * into a running claude is how the second-claude hazard actually happens.
 *
 * The desktop also types when the room was just CREATED by its own spawn. The
 * phone has no create flag - @api's socket opens onto the room's own first
 * bytes with no banner - and does not need one: a room that did not exist
 * cannot have a live agent, so `interactive` is already false and this already
 * returns true. Same coverage, one less thing on the wire.
 */
export const typeOnAttach = (branch: BranchStatus): boolean => !branch.interactive;

/**
 * The one visible command line a door asks for. Mirrors `App.tsx:351-374`.
 *
 * THIS IS THE TERMINAL SLOT (Patrick's ruling, 2026-08-14). Everything
 * claude-specific about a launch lives in this function and nowhere deeper -
 * the socket below it carries bytes and has never heard of claude. When the
 * desktop's slot takes a second terminal, this is the line that changes with
 * it, and the two must change together.
 *
 * `command claude` skips the bashrc boot shim (@hooks session_boot): its
 * continue/new menu is redundant here, because the door press already made that
 * choice.
 */
export function launchCommand(branch: BranchStatus, mode: LaunchMode): string {
  const resume =
    mode !== "resume"
      ? ""
      : branch.has_history
        ? " -c"
        : branch.resume_id
          ? ` --resume ${quote(branch.resume_id)}`
          : "";
  return `cd ${quote(branch.path)} && command claude --permission-mode bypassPermissions${resume}`;
}

/** What the door should say, and what it does - the card's own judgment. */
export interface RoomDoor {
  mode: LaunchMode;
  label: string;
  title: string;
}

/**
 * The doors this card offers, in the order the desktop offers them.
 *
 * A LIVE ROOM RETURNS EXACTLY ONE. That single-element array is the guard made
 * structural: there is no branch of this function where a live claude is
 * offered a resume alongside its attach.
 */
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
  if (canResume(branch)) {
    doors.push({
      mode: "resume",
      label: "▸ resume",
      title: branch.has_history
        ? "attach and continue this branch's last conversation"
        : "attach and resume the last dispatch transcript",
    });
  }
  doors.push({
    mode: "fresh",
    label: "▸ fresh",
    title: "attach and start a new conversation in this room",
  });
  return doors;
}
