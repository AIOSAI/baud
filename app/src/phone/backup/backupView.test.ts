import { describe, expect, it } from "vitest";

import type { BackupProgress, BackupRunning, BackupStatus } from "../../types";
import {
  BACKUP_BUTTONS,
  CURRENT_TAIL,
  JOB_FORGOTTEN,
  NOTHING_UPLOADED,
  NO_PROJECT,
  STATUS_LANES,
  backupBytes,
  backupHead,
  barFraction,
  buttonName,
  buttonPhase,
  buttonWord,
  confirmLine,
  currentTail,
  driveLine,
  elapsedText,
  laneLine,
  leavesMachine,
  outcomeView,
  progressHead,
  progressLine,
  remainingText,
  runningJobs,
  runningVerbs,
  unregisteredLine,
  verbLabel,
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

/** The upload the owner pressed at 06:37 on 2026-10-16, as the contract pins it. */
function progress(over: Partial<BackupProgress> = {}): BackupProgress {
  return {
    done: 1204,
    total: 15414,
    failed: 0,
    bytes_done: 325058560,
    bytes_total: 3113851289,
    current: "projects/.archive/marketstand/inventory/x/photos/03.jpg",
    updated_at: "2026-10-16T13:52:30+00:00",
    ...over,
  };
}

function entry(over: Partial<BackupRunning> = {}): BackupRunning {
  return {
    job: "b7f3c2",
    verb: "drive_sync",
    lane: "drive_sync",
    pid: 175450,
    started_at: "2026-10-16T08:57:50+00:00",
    progress: progress(),
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
  it("adopts the jobs status lists as running, keyed on the pressed verb", () => {
    const answer = status({
      running: [
        entry({ job: "b7f3c2", verb: "snapshot", lane: "snapshot" }),
        entry({ job: "c1d2e3", verb: "all", lane: "versioned" }),
      ],
    });
    expect(runningJobs(answer)).toEqual({ snapshot: "b7f3c2", all: "c1d2e3" });
  });

  it("keeps the first job when a verb is listed twice", () => {
    const answer = status({
      running: [entry({ job: "first", verb: "all", lane: "snapshot" }), entry({ job: "second", verb: "all" })],
    });
    expect(runningJobs(answer)).toEqual({ all: "first" });
  });

  it("skips a run this server did not start: there is no job to read", () => {
    expect(runningJobs(status({ running: [entry({ job: null })] }))).toEqual({});
  });

  it("takes a later entry's job when the first one for the verb has none", () => {
    const answer = status({ running: [entry({ job: null }), entry({ job: "late" })] });
    expect(runningJobs(answer)).toEqual({ drive_sync: "late" });
  });

  it("is empty for no status, or a status with nothing running", () => {
    expect(runningJobs(null)).toEqual({});
    expect(runningJobs(status())).toEqual({});
  });
});

describe("runningVerbs", () => {
  it("lists each verb once, in the order status lists them, never the sub-lane", () => {
    const answer = status({
      running: [
        entry({ verb: "all", lane: "versioned" }),
        entry({ verb: "drive_sync" }),
        entry({ verb: "all", lane: "drive_sync" }),
      ],
    });
    expect(runningVerbs(answer)).toEqual(["all", "drive_sync"]);
  });

  it("lists a terminal's run too: its press reads Stop all the same", () => {
    expect(runningVerbs(status({ running: [entry({ job: null })] }))).toEqual(["drive_sync"]);
  });

  it("is empty for no status", () => {
    expect(runningVerbs(null)).toEqual([]);
  });
});

describe("the Stop/running mapping", () => {
  it("is Stop while status lists the verb, held job or not", () => {
    expect(buttonPhase("drive_sync", ["drive_sync"], true, false)).toBe("stop");
    expect(buttonPhase("drive_sync", ["drive_sync"], false, false)).toBe("stop");
  });

  it("is stopping while a stop is in flight, listed or not", () => {
    expect(buttonPhase("drive_sync", ["drive_sync"], true, true)).toBe("stopping");
    expect(buttonPhase("all", [], false, true)).toBe("stopping");
  });

  it("is watched for a held job status does not list yet", () => {
    expect(buttonPhase("all", ["drive_sync"], true, false)).toBe("watched");
  });

  it("is idle when nothing holds the verb, whatever else runs", () => {
    expect(buttonPhase("snapshot", ["drive_sync", "all"], false, false)).toBe("idle");
  });

  it("puts the words on each phase", () => {
    expect(buttonWord("Sync to Drive", "stop")).toBe("Stop");
    expect(buttonWord("Sync to Drive", "stopping")).toBe("Stopping…");
    expect(buttonWord("Full backup", "watched")).toBe("Full backup · running…");
    expect(buttonWord("Snapshot now", "idle")).toBe("Snapshot now");
  });

  it("names which run a Stop ends, for a screen reader", () => {
    expect(buttonName("Sync to Drive", "stop")).toBe("stop Sync to Drive");
    expect(buttonName("Sync to Drive", "stopping")).toBe("stop Sync to Drive");
    expect(buttonName("Full backup", "watched")).toBe("Full backup");
    expect(buttonName("Snapshot now", "idle")).toBe("Snapshot now");
  });

  it("labels a verb as its press, and an unknown one by its own name", () => {
    expect(verbLabel("all")).toBe("Full backup");
    expect(verbLabel("drive_sync")).toBe("Sync to Drive");
    expect(verbLabel("nightly" as never)).toBe("nightly");
  });
});

describe("backupBytes", () => {
  it("counts in 1024s with @backup's own unit words", () => {
    expect(backupBytes(325058560)).toBe("310 MB");
    expect(backupBytes(3113851289)).toBe("2.9 GB");
  });

  it("steps through B and KB below a megabyte", () => {
    expect(backupBytes(0)).toBe("0 B");
    expect(backupBytes(1023)).toBe("1023 B");
    expect(backupBytes(1024)).toBe("1 KB");
    expect(backupBytes(1024 ** 2 - 1)).toBe("1024 KB");
    expect(backupBytes(1024 ** 2)).toBe("1 MB");
    expect(backupBytes(1024 ** 3)).toBe("1.0 GB");
  });
});

describe("elapsedText", () => {
  it("says seconds, then minutes and seconds, then hours and minutes", () => {
    expect(elapsedText("2026-10-16T08:59:15+00:00", NOW)).toBe("45s");
    expect(elapsedText("2026-10-16T08:59:00+00:00", NOW)).toBe("1m 0s");
    expect(elapsedText("2026-10-16T08:57:50+00:00", NOW)).toBe("2m 10s");
    expect(elapsedText("2026-10-16T07:54:59+00:00", NOW)).toBe("1h 5m");
  });

  it("is 59s just before the minute and 59m just before the hour", () => {
    expect(elapsedText("2026-10-16T08:59:01+00:00", NOW)).toBe("59s");
    expect(elapsedText("2026-10-16T08:00:01+00:00", NOW)).toBe("59m 59s");
    expect(elapsedText("2026-10-16T08:00:00+00:00", NOW)).toBe("1h 0m");
  });

  it("reads a clock behind the server's as 0s, never negative", () => {
    expect(elapsedText("2026-10-16T09:00:05+00:00", NOW)).toBe("0s");
  });

  it("is null for an instant that does not parse", () => {
    expect(elapsedText("not a date", NOW)).toBe(null);
  });
});

describe("barFraction", () => {
  it("is done over total", () => {
    expect(barFraction(progress({ done: 300, total: 1200 }))).toBe(0.25);
  });

  it("is null while scanning, so the bar is the indeterminate one", () => {
    expect(barFraction(null)).toBe(null);
  });

  it("reads empty for a total of zero rather than dividing by it", () => {
    expect(barFraction(progress({ done: 0, total: 0 }))).toBe(0);
  });

  it("never runs past full or below empty", () => {
    expect(barFraction(progress({ done: 20, total: 10 }))).toBe(1);
    expect(barFraction(progress({ done: -1, total: 10 }))).toBe(0);
  });
});

describe("progressLine", () => {
  it("says files, bytes of the planned bytes, and the time left at the rate so far", () => {
    expect(progressLine(entry(), NOW)).toBe("1,204 / 15,414 files · 310 MB of 2.9 GB · 25m 34s left");
  });

  it("drops the of-part when the lane does not know its planned bytes", () => {
    expect(progressLine(entry({ progress: progress({ bytes_total: null }) }), NOW)).toBe(
      "1,204 / 15,414 files · 310 MB · 25m 34s left",
    );
  });

  it("says scanning before the lane has a total", () => {
    expect(progressLine(entry({ progress: null }), NOW)).toBe("scanning…");
  });

  it("drops the elapsed piece when the start does not parse", () => {
    expect(progressLine(entry({ started_at: "" }), NOW)).toBe("1,204 / 15,414 files · 310 MB of 2.9 GB");
  });

  it("ends with the failed count when files have failed", () => {
    expect(progressLine(entry({ progress: progress({ failed: 1203 }) }), NOW)).toBe(
      "1,204 / 15,414 files · 310 MB of 2.9 GB · 25m 34s left · 1,203 failed",
    );
  });

  it("says one failed file", () => {
    expect(progressLine(entry({ progress: progress({ failed: 1 }) }), NOW)).toBe(
      "1,204 / 15,414 files · 310 MB of 2.9 GB · 25m 34s left · 1 failed",
    );
  });

  it("keeps the failed count when the start does not parse", () => {
    expect(progressLine(entry({ started_at: "", progress: progress({ failed: 3 }) }), NOW)).toBe(
      "1,204 / 15,414 files · 310 MB of 2.9 GB · 3 failed",
    );
  });

  it("says nothing of failures at zero or below", () => {
    expect(progressLine(entry({ progress: progress({ failed: -1 }) }), NOW)).toBe(
      "1,204 / 15,414 files · 310 MB of 2.9 GB · 25m 34s left",
    );
  });

  it("shows the time so far until the first file gives a rate", () => {
    expect(progressLine(entry({ progress: progress({ done: 0 }) }), NOW)).toBe(
      "0 / 15,414 files · 310 MB of 2.9 GB · 2m 10s",
    );
  });
});

describe("remainingText", () => {
  it("scales the time so far by the files still to go: 130s for 1,204 of 15,414 is 25m 34s more", () => {
    expect(remainingText(entry(), NOW)).toBe("25m 34s left");
  });

  it("says 0s left when every file is done", () => {
    expect(remainingText(entry({ progress: progress({ done: 15414 }) }), NOW)).toBe("0s left");
  });

  it("is null before the first file, without a total, or when the start does not parse", () => {
    expect(remainingText(entry({ progress: progress({ done: 0 }) }), NOW)).toBe(null);
    expect(remainingText(entry({ progress: null }), NOW)).toBe(null);
    expect(remainingText(entry({ started_at: "" }), NOW)).toBe(null);
  });
});

describe("backupHead", () => {
  it("shows the seat's name and the answer's root", () => {
    expect(backupHead("baud", status())).toEqual({ name: "baud", path: "/home/alice/AIPass/projects/baud" });
  });

  it("shows the name alone before any answer", () => {
    expect(backupHead("baud", null)).toEqual({ name: "baud", path: null });
  });

  it("never shows another seat's root under this seat's name", () => {
    expect(backupHead("AIPass", status())).toEqual({ name: "AIPass", path: null });
  });

  it("matches the seat exactly, as the server echoes it", () => {
    expect(backupHead("Baud", status())).toEqual({ name: "Baud", path: null });
  });

  it("shows no path for an empty root", () => {
    expect(backupHead("baud", status({ root: "" }))).toEqual({ name: "baud", path: null });
  });

  it("says no project, with no path, when nothing is seated", () => {
    expect(backupHead("", status({ project: "" }))).toEqual({ name: "no project", path: null });
  });
});

describe("the no-project and unregistered lines", () => {
  it("says no project is seated", () => {
    expect(NO_PROJECT).toBe("no project is seated yet");
  });

  it("names the store as missing and the command that makes one", () => {
    expect(unregisteredLine("/home/alice/AIPass/projects/baud")).toBe(
      "this project has no backup store yet — register it with drone @backup register /home/alice/AIPass/projects/baud",
    );
  });
});

describe("progressHead", () => {
  it("names the press for a single lane", () => {
    expect(progressHead(entry())).toBe("Sync to Drive");
  });

  it("names Full backup's sub-lane with its counts", () => {
    expect(progressHead(entry({ verb: "all", lane: "versioned", progress: progress({ done: 300, total: 15491 }) }))).toBe(
      "Full backup · versioned · 300 / 15,491",
    );
  });

  it("marks thousands on both of the sub-lane's counts", () => {
    expect(progressHead(entry({ verb: "all", lane: "drive_sync" }))).toBe("Full backup · drive_sync · 1,204 / 15,414");
  });

  it("names the sub-lane alone while it scans", () => {
    expect(progressHead(entry({ verb: "all", lane: "snapshot", progress: null }))).toBe("Full backup · snapshot");
  });
});

describe("currentTail", () => {
  it("keeps a path that fits as it came", () => {
    expect(currentTail("src/app.ts")).toBe("src/app.ts");
    const fits = "a".repeat(CURRENT_TAIL);
    expect(currentTail(fits)).toBe(fits);
  });

  it("keeps a long path's end, cut at a folder boundary", () => {
    expect(currentTail("projects/.archive/marketstand/inventory/x/photos/03.jpg")).toBe(
      "…/.archive/marketstand/inventory/x/photos/03.jpg",
    );
  });

  it("drops a name the cut would show half", () => {
    expect(currentTail("abcdefghij/klm/no.txt", 13)).toBe("…/klm/no.txt");
  });

  it("cuts mid-name only when no folder boundary falls in the tail", () => {
    expect(currentTail(`dir/${"b".repeat(60)}`, 10)).toBe(`…${"b".repeat(9)}`);
  });

  it("is null before the first file, and for an empty name", () => {
    expect(currentTail(null)).toBe(null);
    expect(currentTail("")).toBe(null);
  });
});

describe("outcomeView", () => {
  const HEADROOM = "Drive has 1.4 GB free; this run needs 2.9 GB. Nothing uploaded.";

  it("leads a headroom refusal with its own sentence, verbatim", () => {
    expect(outcomeView("Sync to Drive", "failed", `Scanning store\n${HEADROOM}\n`)).toEqual({
      tone: "failed",
      head: `Sync to Drive · ${HEADROOM}`,
      body: "Scanning store",
    });
  });

  it("leaves no block when the sentence is the whole summary", () => {
    expect(outcomeView("Full backup", "failed", HEADROOM)).toEqual({
      tone: "failed",
      head: `Full backup · ${HEADROOM}`,
      body: "",
    });
  });

  it("keeps today's rendering for any other failure", () => {
    const text = "upload failed: 403 storageQuotaExceeded";
    expect(outcomeView("Sync to Drive", "failed", text)).toEqual({ tone: "failed", head: "Sync to Drive · failed", body: text });
  });

  it("looks only at the last line, not a Nothing uploaded. said earlier", () => {
    const text = `${HEADROOM}\nretrying with the tracker\nupload failed`;
    expect(outcomeView("Sync to Drive", "failed", text).head).toBe("Sync to Drive · failed");
  });

  it("never promotes the sentence on a run that did not fail", () => {
    expect(outcomeView("Sync to Drive", "done", HEADROOM).head).toBe("Sync to Drive · done");
  });

  it("shows stopped as its own word with the summary verbatim", () => {
    const text = "stopped by request: 1,204 of 15,414 files, 310 MB";
    expect(outcomeView("Sync to Drive", "stopped", text)).toEqual({ tone: "stopped", head: "Sync to Drive · stopped", body: text });
  });

  it("keeps the forgotten job's sentence under its own word", () => {
    expect(outcomeView("Snapshot now", "forgotten", JOB_FORGOTTEN)).toEqual({
      tone: "forgotten",
      head: "Snapshot now · forgotten",
      body: JOB_FORGOTTEN,
    });
  });

  it("matches the contract's sentence ending", () => {
    expect(NOTHING_UPLOADED).toBe("Nothing uploaded.");
  });
});

describe("JOB_FORGOTTEN", () => {
  it("sends the reader to the status lines rather than guessing an outcome", () => {
    expect(JOB_FORGOTTEN).toBe("the server restarted and forgot this run - its outcome is in the status lines above now");
  });
});
