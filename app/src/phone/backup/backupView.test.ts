import { describe, expect, it } from "vitest";

import type { BackupStatus } from "../../types";
import {
  BACKUP_BUTTONS,
  JOB_FORGOTTEN,
  STATUS_LANES,
  confirmLine,
  driveLine,
  laneLine,
  leavesMachine,
  runningJobs,
} from "./backupView";

const NOW = Date.parse("2026-10-16T09:00:00+00:00");

/** BAUD's store as `drone @backup status --json` answered it on 2026-10-16. */
function status(over: Partial<BackupStatus> = {}): BackupStatus {
  return {
    project: "baud",
    root: "/home/alice/AIPass/projects/baud",
    registered: true,
    mode: "snapshot",
    drive_sync: false,
    runs: 6,
    lanes: {
      snapshot: { last: "2026-10-16T07:00:00+00:00", files: 15414 },
      versioned: { last: "2026-09-28T03:12:00+00:00", files: 4 },
      drive_sync: { last: null, files: null },
    },
    drive: { tracked_files: 12 },
    running: [],
    ...over,
  };
}

describe("the four click options", () => {
  it("are the owner's words, in his order, on the contract's lane names", () => {
    expect(BACKUP_BUTTONS).toEqual([
      { lane: "snapshot", label: "Snapshot now" },
      { lane: "versioned", label: "Versioned now" },
      { lane: "all", label: "Full backup" },
      { lane: "drive_sync", label: "Sync to Drive" },
    ]);
  });

  it("list the status lanes in the contract's order, with no line for all", () => {
    expect(STATUS_LANES.map((lane) => lane.key)).toEqual(["snapshot", "versioned", "drive_sync"]);
  });
});

describe("laneLine", () => {
  it("says the age and the file count with thousands marked", () => {
    expect(laneLine("Snapshot", status().lanes.snapshot, NOW)).toBe("Snapshot · 2h ago · 15,414 files");
  });

  it("uses the face's own age words for days", () => {
    expect(laneLine("Versioned", status().lanes.versioned, NOW)).toBe("Versioned · 18d ago · 4 files");
  });

  it("says never for a lane that never ran, never a zero", () => {
    expect(laneLine("Drive", status().lanes.drive_sync, NOW)).toBe("Drive · never");
  });

  it("never puts a count beside never, even when a count rides along", () => {
    expect(laneLine("Versioned", { last: null, files: 4 }, NOW)).toBe("Versioned · never");
  });

  it("says never when the answer carried no entry for the lane", () => {
    expect(laneLine("Drive", undefined, NOW)).toBe("Drive · never");
  });

  it("drops the count, not the age, when a dated run has no file count", () => {
    expect(laneLine("Snapshot", { last: "2026-10-16T08:59:30+00:00", files: null }, NOW)).toBe("Snapshot · 30s ago");
  });
});

describe("driveLine", () => {
  it("says the project's Drive setting as on or off", () => {
    expect(driveLine(status())).toBe("Drive sync setting · off");
    expect(driveLine(status({ drive_sync: true }))).toBe("Drive sync setting · on");
  });
});

describe("leavesMachine", () => {
  it("never asks for the two lanes that stay on this machine", () => {
    expect(leavesMachine("snapshot", true)).toBe(false);
    expect(leavesMachine("versioned", null)).toBe(false);
  });

  it("always asks for Sync to Drive, whatever the setting says", () => {
    expect(leavesMachine("drive_sync", false)).toBe(true);
  });

  it("asks for Full backup only when the Drive setting is on", () => {
    expect(leavesMachine("all", true)).toBe(true);
    expect(leavesMachine("all", false)).toBe(false);
  });

  it("asks for Full backup when the setting is not known yet", () => {
    expect(leavesMachine("all", null)).toBe(true);
  });
});

describe("confirmLine", () => {
  it("names the project and where the files go", () => {
    expect(confirmLine("drive_sync", "baud")).toBe("Sync baud's backups to Google Drive?");
    expect(confirmLine("all", "baud")).toBe("Run a full backup of baud, including its Drive sync?");
  });
});

describe("runningJobs", () => {
  it("adopts the jobs status lists as running, by lane", () => {
    const answer = status({
      running: [
        { job: "b7f3c2", lane: "snapshot", started_at: "2026-10-16T08:59:00+00:00" },
        { job: "c1d2e3", lane: "versioned", started_at: "2026-10-16T08:58:00+00:00" },
      ],
    });
    expect(runningJobs(answer)).toEqual({ snapshot: "b7f3c2", versioned: "c1d2e3" });
  });

  it("keeps the first job when a lane is listed twice", () => {
    const answer = status({
      running: [
        { job: "first", lane: "all", started_at: "2026-10-16T08:59:00+00:00" },
        { job: "second", lane: "all", started_at: "2026-10-16T08:59:30+00:00" },
      ],
    });
    expect(runningJobs(answer)).toEqual({ all: "first" });
  });

  it("is empty for no status, or a status with nothing running", () => {
    expect(runningJobs(null)).toEqual({});
    expect(runningJobs(status())).toEqual({});
  });
});

describe("JOB_FORGOTTEN", () => {
  it("sends the reader to the status lines rather than guessing an outcome", () => {
    expect(JOB_FORGOTTEN).toBe("the server restarted and forgot this run - its outcome is in the status lines above now");
  });
});
