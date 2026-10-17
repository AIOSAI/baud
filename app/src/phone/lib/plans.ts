/** An agent's plans, read off `sections.flow` of its DASHBOARD.local.json (kept by @flow); pure. */

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

export const NO_OPEN = "no open plans";
export const NOTHING_CLOSED = "nothing closed lately";
export const NO_COUNT = "no plan count on this dashboard";
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

/** The flow section, parsed; the count falls back to `quick_status.active_plans`, the figure the tile shows. */
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

export function plansHead(active: number | null): string {
  if (active === null) return NO_COUNT;
  return `${active} active plan${active === 1 ? "" : "s"}`;
}
