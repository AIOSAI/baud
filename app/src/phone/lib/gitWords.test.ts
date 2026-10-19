import { describe, expect, it } from "vitest";

import type { GitRemote, GitRoot } from "../../types";
import {
  FLEET_NOT_LANDED,
  NO_AGENT_HERE,
  messageBody,
  noAgentLine,
  noRemote,
  rootAddress,
  rowOpen,
} from "./gitWords";

const AIPASS_ROOT: GitRoot = { kind: "aipass", name: null };
const BAUD_ROOT: GitRoot = { kind: "project", name: "BAUD" };

describe("rowOpen", () => {
  it("opens a tracked row's diff, at either grain", () => {
    expect(rowOpen("README.md", " M", "branch")).toBe("diff");
    expect(rowOpen("src/aipass/api/x.py", "A ", "repo")).toBe("diff");
    expect(rowOpen("gone.md", " D", "branch")).toBe("diff");
  });

  it("reads an untracked file at branch grain", () => {
    expect(rowOpen("notes/new.md", "??", "branch")).toBe("read");
  });

  it("answers under an untracked file at repo grain", () => {
    expect(rowOpen("src/aipass/api/new.md", "??", "repo")).toBe("file");
  });

  it("answers under an untracked directory, at either grain", () => {
    expect(rowOpen("drafts/", "??", "branch")).toBe("dir");
    expect(rowOpen("src/aipass/api/drafts/", "??", "repo")).toBe("dir");
  });

  it("keeps a tracked directory-shaped path on the diff lane", () => {
    expect(rowOpen("odd/", " M", "branch")).toBe("diff");
  });

  it("reads an untracked file and browses an untracked directory at repo grain under a named root", () => {
    for (const root of [AIPASS_ROOT, BAUD_ROOT]) {
      expect(rowOpen("src/aipass/api/new.md", "??", "repo", root)).toBe("read");
      expect(rowOpen("src/aipass/api/drafts/", "??", "repo", root)).toBe("browse");
    }
  });

  it("keeps the words at repo grain when no root holds the tree", () => {
    expect(rowOpen("vendor/x/new.md", "??", "repo", null)).toBe("file");
    expect(rowOpen("vendor/x/drafts/", "??", "repo", null)).toBe("dir");
  });

  it("ignores a root at branch grain, where the path is branch-local", () => {
    expect(rowOpen("drafts/", "??", "branch", BAUD_ROOT)).toBe("dir");
    expect(rowOpen("notes/new.md", "??", "branch", BAUD_ROOT)).toBe("read");
  });

  it("keeps a tracked row on the diff lane under a root", () => {
    expect(rowOpen("src/x.py", " M", "repo", AIPASS_ROOT)).toBe("diff");
  });
});

describe("rootAddress", () => {
  it("lets the nameless aipass root name itself", () => {
    expect(rootAddress(AIPASS_ROOT)).toEqual({ word: "aipass", root: "aipass" });
  });

  it("puts a project's census name first", () => {
    expect(rootAddress(BAUD_ROOT)).toEqual({ word: "BAUD", root: "project" });
  });
});

describe("messageBody", () => {
  it("drops the subject and the blank line under it", () => {
    expect(messageBody("Fix the thing\n\nIt was broken.\nNow it is not.\n")).toBe(
      "It was broken.\nNow it is not.",
    );
  });

  it("is empty for a one-line commit", () => {
    expect(messageBody("Fix the thing\n")).toBe("");
    expect(messageBody("Fix the thing")).toBe("");
  });

  it("is empty when only blank lines follow the subject", () => {
    expect(messageBody("Fix the thing\n\n\n  \n")).toBe("");
  });

  it("drops every blank line between the subject and the body", () => {
    expect(messageBody("Subject\n\n\nBody")).toBe("Body");
  });

  it("keeps blank lines inside the body", () => {
    expect(messageBody("Subject\n\nOne\n\nTwo")).toBe("One\n\nTwo");
  });

  it("keeps a body line that starts with spaces as it was", () => {
    expect(messageBody("Subject\n\n  indented")).toBe("  indented");
  });

  it("reads CRLF messages the same way", () => {
    expect(messageBody("Subject\r\n\r\nOne\r\nTwo")).toBe("One\nTwo");
  });

  it("drops a whitespace-only line under the subject", () => {
    expect(messageBody("Subject\n  \nBody")).toBe("Body");
  });

  it("takes the subject as the first line with text, past any leading blank lines", () => {
    expect(messageBody("\n\nSubject\n\nBody")).toBe("Body");
  });

  it("is empty for an empty message", () => {
    expect(messageBody("")).toBe("");
  });
});

describe("noAgentLine", () => {
  it("says has not landed only while the fleet read has not answered", () => {
    expect(noAgentLine(false)).toBe(FLEET_NOT_LANDED);
    expect(FLEET_NOT_LANDED).toMatch(/has not landed/);
  });

  it("says the project has no agent when the fleet answered empty", () => {
    expect(noAgentLine(true)).toBe(NO_AGENT_HERE);
    expect(NO_AGENT_HERE).toBe("no agent in this project to read the repository through");
  });
});

describe("noRemote", () => {
  const base: GitRemote = {
    branch: "devpulse",
    grain: "repo",
    remote: "origin",
    url: "git@github.com:owner/repo.git",
    web: "https://github.com/owner/repo",
    redacted: false,
  };

  it("is false for a remote with a name", () => {
    expect(noRemote(base)).toBe(false);
  });

  it("is true for the contract's remote: null answer", () => {
    expect(noRemote({ ...base, remote: null, url: null, web: null })).toBe(true);
  });

  it("is true when the name is absent or empty", () => {
    const absent = { branch: "devpulse", grain: "repo", url: null, web: null, redacted: false };
    expect(noRemote(absent as unknown as GitRemote)).toBe(true);
    expect(noRemote({ ...base, remote: "" })).toBe(true);
  });

  it("is false for a remote with no browsable page (still a remote)", () => {
    expect(noRemote({ ...base, url: "/srv/git/repo.git", web: null })).toBe(false);
  });
});
