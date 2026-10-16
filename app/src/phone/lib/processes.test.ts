import { describe, expect, it } from "vitest";

import type { MachineProcesses } from "../../types";
import { PROCESS_LIMIT, type ProcessRow, memText, pctText, processName, sampledLine, sortProcesses } from "./processes";

function row(over: Partial<ProcessRow>): ProcessRow {
  return { pid: 1, name: "proc", cpu_pct: 0, mem_pct: 0, mem_mb: 0, user: "patrick", state: "sleeping", ...over };
}

function read(over: Partial<MachineProcesses> = {}): MachineProcesses {
  return {
    sampled_at: "2026-10-16T15:20:00+00:00",
    window_ms: 512,
    total: 249,
    sort: "cpu",
    processes: [row({ pid: 1 }), row({ pid: 2 })],
    ...over,
  };
}

const pids = (rows: ProcessRow[]) => rows.map((each) => each.pid);

describe("PROCESS_LIMIT", () => {
  it("is the owner's twenty", () => {
    expect(PROCESS_LIMIT).toBe(20);
  });
});

describe("sortProcesses", () => {
  const rows = [
    row({ pid: 1, cpu_pct: 5, mem_pct: 30 }),
    row({ pid: 2, cpu_pct: 40, mem_pct: 1 }),
    row({ pid: 3, cpu_pct: 5, mem_pct: 2 }),
    row({ pid: 4, cpu_pct: 0.5, mem_pct: 12 }),
  ];

  it("cpu puts the busiest first and breaks a cpu tie by memory share", () => {
    expect(pids(sortProcesses(rows, "cpu"))).toEqual([2, 1, 3, 4]);
  });

  it("cpu re-orders a cpu tie the host sent smaller-memory first", () => {
    const tied = [row({ pid: 3, cpu_pct: 5, mem_pct: 2 }), row({ pid: 1, cpu_pct: 5, mem_pct: 30 })];
    expect(pids(sortProcesses(tied, "cpu"))).toEqual([1, 3]);
  });

  it("mem puts the biggest share first", () => {
    expect(pids(sortProcesses(rows, "mem"))).toEqual([1, 4, 3, 2]);
  });

  it("mem breaks a memory tie by cpu", () => {
    const tied = [row({ pid: 1, mem_pct: 3, cpu_pct: 1 }), row({ pid: 2, mem_pct: 3, cpu_pct: 9 })];
    expect(pids(sortProcesses(tied, "mem"))).toEqual([2, 1]);
  });

  it("keeps the host's order for rows tied on both keys", () => {
    const tied = [row({ pid: 7, cpu_pct: 1, mem_pct: 1 }), row({ pid: 3, cpu_pct: 1, mem_pct: 1 })];
    expect(pids(sortProcesses(tied, "cpu"))).toEqual([7, 3]);
  });

  it("returns a new array and leaves the read as the host sent it", () => {
    const held = [...rows];
    const sorted = sortProcesses(rows, "mem");
    expect(sorted).not.toBe(rows);
    expect(rows).toEqual(held);
  });
});

describe("processName", () => {
  it("is the name the host gave", () => {
    expect(processName(row({ name: "firefox" }))).toBe("firefox");
  });

  it("is the pid when the name came back empty", () => {
    expect(processName(row({ pid: 4242, name: "" }))).toBe("pid 4242");
  });

  it("is the pid when the name is only whitespace", () => {
    expect(processName(row({ pid: 9, name: "  " }))).toBe("pid 9");
  });
});

describe("pctText and memText", () => {
  it("prints a percent to one place", () => {
    expect(pctText(42.46)).toBe("42.5%");
    expect(pctText(0)).toBe("0.0%");
  });

  it("prints resident memory in whole MB", () => {
    expect(memText(512)).toBe("512 MB");
    expect(memText(511.6)).toBe("512 MB");
  });
});

describe("sampledLine", () => {
  const clock = (iso: string) => `at(${iso})`;

  it("says sampling while a read is in flight, even over an old list", () => {
    expect(sampledLine(read(), true, clock)).toBe("sampling…");
    expect(sampledLine(null, true, clock)).toBe("sampling…");
  });

  it("offers a sample when nothing has been read and nothing is in flight", () => {
    expect(sampledLine(null, false, clock)).toBe("tap to sample");
  });

  it("names how many of the total are shown, when, over how long, and the tap", () => {
    expect(sampledLine(read(), false, clock)).toBe(
      "top 2 of 249 · sampled at(2026-10-16T15:20:00+00:00) over 0.5 s · tap to sample again",
    );
  });
});
