import type { BranchStatus, NewProjectResult } from "../../types";

// Mirrors the host's rule so a typo is refused before the request; the host still decides.
const NAME_RULE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export const NAME_HINT = "letters, digits, _ and -, starting with a letter";

export const TEMPLATES = ["empty", "python"] as const;

export const DEFAULT_TEMPLATE = TEMPLATES[0];

export function validName(name: string): boolean {
  return NAME_RULE.test(name);
}

export function nameRefusal(name: string): string | null {
  if (validName(name)) return null;
  if (!name) return `name the project first: ${NAME_HINT}`;
  return `'${name}' is not a project name: ${NAME_HINT}, up to 64 characters`;
}

// The census keys a project by its registry name, which is not the typed name.
export function bornSeat(result: NewProjectResult): string {
  return result.project;
}

/** The manager's card as the host just made it: no room, no history, nothing dispatched. */
export function bornCard(result: NewProjectResult): BranchStatus {
  return {
    name: result.agent,
    path: result.agent_home,
    project: bornSeat(result),
    is_citizen: true,
    manager: true,
    citizen_class: "manager",
    dispatched: false,
    interactive: false,
    has_history: false,
    resume_id: null,
    provider: "claude",
    room: "",
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
  };
}
