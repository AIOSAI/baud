import { describe, expect, it } from "vitest";

import { copyText, machinePath, underRoot } from "./copyPath";

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
