/**
 * An agent's plans, read off its dashboard (DPLAN-0414 T1, A#2).
 *
 * The PLANS tile used to open the whole `DASHBOARD.local.json` raw. It now
 * opens a screen that reads that same file through the files lane and draws
 * the one section the tile counts: `sections.flow`, which @flow keeps -
 * `active_plans`, `open_recent[]` (`plan_id`, `subject`, `created`) and
 * `recently_closed[]` (`id`, `subject`, `closed`). No new route (compass
 * #293), the memory screen's pattern.
 *
 * PURE, so the words are tested without a browser.
 */

/** One plan row: its id, its subject, and the timestamp its age is read from. */
export interface PlanRow {
  id: string;
  subject: string;
  /** ISO timestamp, or "" when the row carries none. */
  when: string;
}

export interface Plans {
  /** The active count, or null when the dashboard states none. */
  active: number | null;
  open: PlanRow[];
  closed: PlanRow[];
}

/** The two stated absences. A list with nothing in it says so. */
export const NO_OPEN = "no open plans";
export const NOTHING_CLOSED = "nothing closed lately";
/** The head when no count is written anywhere on the dashboard. */
export const NO_COUNT = "no plan count on this dashboard";
/** A row whose subject is missing. */
export const NO_PLAN_SUBJECT = "(no subject)";

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

function rows(list: unknown, idKey: string, whenKey: string): PlanRow[] {
  if (!Array.isArray(list)) return [];
  return list.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    return {
      id: text(row[idKey]) ?? "",
      subject: text(row.subject) ?? NO_PLAN_SUBJECT,
      when: text(row[whenKey]) ?? "",
    };
  });
}

/**
 * The flow section, parsed. The count is `flow.active_plans`, falling back to
 * the dashboard's own `quick_status.active_plans` - the figure the tile itself
 * shows - when the section does not carry one. An absent section is two empty
 * lists, which the screen states in words.
 */
export function readPlans(raw: unknown): Plans {
  const doc = (raw ?? {}) as Record<string, unknown>;
  const sections = (doc.sections ?? {}) as Record<string, unknown>;
  const flow = (sections.flow ?? {}) as Record<string, unknown>;
  const quick = (doc.quick_status ?? {}) as Record<string, unknown>;
  return {
    active: count(flow.active_plans) ?? count(quick.active_plans),
    open: rows(flow.open_recent, "plan_id", "created"),
    closed: rows(flow.recently_closed, "id", "closed"),
  };
}

/** The screen's head: `25 active plans`, `1 active plan`, or the absence. */
export function plansHead(active: number | null): string {
  if (active === null) return NO_COUNT;
  return `${active} active plan${active === 1 ? "" : "s"}`;
}
