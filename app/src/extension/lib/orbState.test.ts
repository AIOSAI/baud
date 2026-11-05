import { describe, expect, it } from "vitest";

import type { FleetEntry, OrbInputs } from "../messages";
import { agentId, energy, orbMode, ringsOf } from "./orbState";

const entry = (over: Partial<FleetEntry>): FleetEntry =>
  ({ name: "api", project: "aipass", interactive: false, dispatched: false, subagents: 0, ...over }) as FleetEntry;
const inputs = (over: Partial<OrbInputs>): OrbInputs => ({ busy: false, waiting: false, acting: false, speaking: false, loudness: 0, ...over });

describe("rings", () => {
  it("draws live and dispatched agents only, with sub-agents and working flags", () => {
    const rings = ringsOf([
      entry({ name: "a", interactive: true, busy: true }),
      entry({ name: "b", dispatched: 2 as unknown as boolean, subagents: 3 }),
      entry({ name: "c" }),
      entry({ name: "d", interactive: true, state: "working" }),
    ]);
    expect(rings).toEqual([
      { working: true, dispatched: false, subagents: 0 },
      { working: false, dispatched: true, subagents: 3 },
      { working: true, dispatched: false, subagents: 0 },
    ]);
  });

  it("names an agent project/name", () => {
    expect(agentId(entry({}))).toBe("aipass/api");
  });
});

describe("orb mode from the open agent", () => {
  const fleet = [entry({ busy: true, interactive: true })];

  it("is idle with no open agent", () => {
    expect(orbMode(null, fleet, inputs({ busy: true }))).toEqual({ mode: "idle", speaker: 0 });
  });

  it("follows the panel: speaking, then waiting, then acting/thinking", () => {
    expect(orbMode("aipass/api", [], inputs({ speaking: true, busy: true, loudness: 0.6 }))).toEqual({ mode: "speaking", speaker: 0.6 });
    expect(orbMode("aipass/api", [], inputs({ waiting: true, busy: true }))).toEqual({ mode: "listening", speaker: 0 });
    expect(orbMode("aipass/api", [], inputs({ busy: true, acting: true }))).toEqual({ mode: "acting", speaker: 0 });
    expect(orbMode("aipass/api", [], inputs({ busy: true }))).toEqual({ mode: "thinking", speaker: 0 });
    expect(orbMode("aipass/api", fleet, inputs({}))).toEqual({ mode: "idle", speaker: 0 });
  });

  it("falls back to the fleet entry with the panel closed", () => {
    expect(orbMode("aipass/api", fleet, null).mode).toBe("thinking");
    expect(orbMode("aipass/other", fleet, null).mode).toBe("idle");
  });
});

describe("energy", () => {
  it("has a floor per mode and the voice on top", () => {
    const t = 0.37;
    expect(energy("idle", 0, t)).toBeLessThan(0.09);
    expect(energy("thinking", 0, t)).toBeGreaterThanOrEqual(0.1);
    expect(energy("acting", 0, t)).toBeGreaterThanOrEqual(0.25);
    expect(energy("speaking", 0, t)).toBeGreaterThanOrEqual(0.25);
    expect(energy("listening", 0, t)).toBeGreaterThanOrEqual(0.12);
    expect(energy("speaking", 0.9, t)).toBe(0.9);
  });
});
