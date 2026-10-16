import { describe, expect, it } from "vitest";

import { NO_COUNT, NO_PLAN_SUBJECT, plansHead, readPlans } from "./plans";

const dashboard = {
  quick_status: { active_plans: 25 },
  sections: {
    flow: {
      active_plans: 24,
      open_recent: [
        { plan_id: "DPLAN-0414", subject: "BAUD phone review", created: "2026-10-16T21:12:32+00:00" },
        { plan_id: "DPLAN-0412", subject: "Backup card round 2", created: "2026-10-16T13:53:28+00:00" },
      ],
      recently_closed: [{ id: "PPLAN-0068", subject: "Merge train", closed: "2026-10-16T06:08:13+00:00" }],
    },
  },
};

describe("readPlans", () => {
  it("takes the count from the flow section first", () => {
    expect(readPlans(dashboard).active).toBe(24);
  });

  it("falls back to quick_status.active_plans when flow has no count", () => {
    const doc = { ...dashboard, sections: { flow: { open_recent: [] } } };
    expect(readPlans(doc).active).toBe(25);
  });

  it("does not take a negative count, and falls back past it", () => {
    expect(readPlans({ sections: { flow: { active_plans: -2 } }, quick_status: { active_plans: 25 } }).active).toBe(25);
  });

  it("is null when neither place carries a count", () => {
    expect(readPlans({ sections: { flow: {} } }).active).toBe(null);
  });

  it("reads zero as a count, not as an absence", () => {
    expect(readPlans({ sections: { flow: { active_plans: 0 } }, quick_status: { active_plans: 5 } }).active).toBe(0);
  });

  it("reads open rows by plan_id, subject and created, in file order", () => {
    expect(readPlans(dashboard).open).toEqual([
      { id: "DPLAN-0414", subject: "BAUD phone review", when: "2026-10-16T21:12:32+00:00" },
      { id: "DPLAN-0412", subject: "Backup card round 2", when: "2026-10-16T13:53:28+00:00" },
    ]);
  });

  it("reads closed rows by id, subject and closed", () => {
    expect(readPlans(dashboard).closed).toEqual([
      { id: "PPLAN-0068", subject: "Merge train", when: "2026-10-16T06:08:13+00:00" },
    ]);
  });

  it("states a missing subject and leaves a missing time empty", () => {
    expect(readPlans({ sections: { flow: { open_recent: [{ plan_id: "X" }] } } }).open).toEqual([
      { id: "X", subject: NO_PLAN_SUBJECT, when: "" },
    ]);
  });

  it("reads an absent flow section as two empty lists", () => {
    expect(readPlans({ sections: {} })).toEqual({ active: null, open: [], closed: [] });
  });

  it("reads null as two empty lists", () => {
    expect(readPlans(null)).toEqual({ active: null, open: [], closed: [] });
  });
});

describe("plansHead", () => {
  it("reads N active plans", () => {
    expect(plansHead(25)).toBe("25 active plans");
  });

  it("is singular at one", () => {
    expect(plansHead(1)).toBe("1 active plan");
  });

  it("says zero out loud", () => {
    expect(plansHead(0)).toBe("0 active plans");
  });

  it("states the absence when no count exists", () => {
    expect(plansHead(null)).toBe(NO_COUNT);
    expect(NO_COUNT).toBe("no plan count on this dashboard");
  });
});
