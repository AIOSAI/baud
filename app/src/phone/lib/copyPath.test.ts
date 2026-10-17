import { describe, expect, it } from "vitest";

import { copyReport, copyShown, copyText, machinePath, underRoot } from "./copyPath";

describe("machinePath", () => {
  it("puts the relative on the end of the floor: /home/alice + app/src/main.ts", () => {
    expect(machinePath("/home/alice", "app/src/main.ts")).toBe("/home/alice/app/src/main.ts");
  });

  it("is the floor itself for a root's own listing (empty relative)", () => {
    expect(machinePath("/home/alice", "")).toBe("/home/alice");
  });

  it("builds /notes.md on a floor of /, never //notes.md", () => {
    expect(machinePath("/", "notes.md")).toBe("/notes.md");
  });

  it("is / for the root of a floor of /", () => {
    expect(machinePath("/", "")).toBe("/");
  });

  it("takes a trailing slash off the floor so exactly one separator goes back", () => {
    expect(machinePath("/home/alice/", "notes.md")).toBe("/home/alice/notes.md");
  });

  it("refuses with an empty string when the floor is empty", () => {
    expect(machinePath("", "app/src/main.ts")).toBe("");
  });

  it("refuses with an empty string when the server sent no floor", () => {
    expect(machinePath(undefined, "x")).toBe("");
  });
});

describe("underRoot", () => {
  it("drops the branch name: baud/docs/notes.md -> docs/notes.md", () => {
    expect(underRoot("baud/docs/notes.md")).toBe("docs/notes.md");
  });

  it("is empty for a bare branch name", () => {
    expect(underRoot("baud")).toBe("");
  });

  it("is empty for a branch name with a trailing slash", () => {
    expect(underRoot("baud/")).toBe("");
  });
});

describe("copyText", () => {
  it("refuses empty text without touching any clipboard", async () => {
    await expect(copyText("")).resolves.toBe(false);
  });
});

describe("copyReport", () => {
  it("claims a copy only when the clipboard API confirmed it, and hides the manual field", () => {
    expect(copyReport("clipboard", "the link")).toEqual({
      note: "copied the link - the clipboard confirmed it",
      showText: false,
    });
  });

  it("calls execCommand's yes unconfirmed and still shows the text to copy by hand", () => {
    const report = copyReport("legacy", "the link");
    expect(report.showText).toBe(true);
    expect(report.note).toMatch(/^the browser says it copied the link, but .* can say that and copy nothing/);
  });

  it("says not copied on a refusal and shows the text to copy by hand", () => {
    const report = copyReport("refused", "18 characters");
    expect(report.showText).toBe(true);
    expect(report.note).toMatch(/^not copied/);
    expect(report.note).not.toMatch(/copied 18/);
  });
});

describe("copyShown", () => {
  const PATH = "/home/alice/games/.REGISTRY.lock";

  it("ticks only for a confirmed clipboard copy, with no note and no field", () => {
    expect(copyShown("clipboard", PATH)).toEqual({ copied: true, note: null, byHand: null });
  });

  it("does not tick on the legacy lane: it says so and holds the path out for a long-press", () => {
    expect(copyShown("legacy", PATH)).toEqual({
      copied: false,
      note: copyReport("legacy", "the path").note,
      byHand: PATH,
    });
  });

  it("does not tick on a refusal: it says not copied and holds the path out", () => {
    const shown = copyShown("refused", PATH);
    expect(shown.copied).toBe(false);
    expect(shown.note).toBe(copyReport("refused", "the path").note);
    expect(shown.byHand).toBe(PATH);
  });

  it("names the thing it copied as the path", () => {
    expect(copyShown("legacy", PATH).note).toMatch(/^the browser says it copied the path, /);
  });
});
