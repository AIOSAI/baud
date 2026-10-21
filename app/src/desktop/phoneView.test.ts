import { describe, expect, it } from "vitest";

import { isAppView, phoneTabKey, phoneTabLabel } from "./phoneView";

describe("phoneTabKey", () => {
  it("keys each app once, whatever the seat", () => {
    expect(phoneTabKey({ screen: "git", project: "BAUD" })).toBe("app:git");
    expect(phoneTabKey({ screen: "git", project: "AIPASS" })).toBe("app:git");
    expect(phoneTabKey({ screen: "files", project: "BAUD" })).toBe("app:files");
    expect(phoneTabKey({ screen: "backup", project: "BAUD" })).toBe("app:backup");
    expect(phoneTabKey({ screen: "machine" })).toBe("app:machine");
  });

  it("keys a card door by door, project and agent", () => {
    expect(phoneTabKey({ screen: "inbox", branch: "devpulse", project: "AIPASS" })).toBe("inbox:AIPASS/devpulse");
    expect(phoneTabKey({ screen: "inbox", branch: "devpulse", project: "AIPASS", openId: "a1" })).toBe(
      "inbox:AIPASS/devpulse",
    );
    expect(phoneTabKey({ screen: "inbox", branch: "devpulse", project: "BAUD" })).not.toBe("inbox:AIPASS/devpulse");
    expect(phoneTabKey({ screen: "branch-git", branch: "baud", project: "BAUD" })).toBe("branch-git:BAUD/baud");
  });
});

describe("phoneTabLabel", () => {
  it("names apps under app/ and doors under their agent", () => {
    expect(phoneTabLabel({ screen: "machine" })).toEqual({ branch: "app", name: "machine" });
    expect(phoneTabLabel({ screen: "plans", branch: "flow", project: "AIPASS" })).toEqual({ branch: "flow", name: "plans" });
    expect(phoneTabLabel({ screen: "branch-files", branch: "flow", project: "AIPASS" })).toEqual({ branch: "flow", name: "files" });
  });

  it("tells an app from a card door", () => {
    expect(isAppView({ screen: "backup", project: "BAUD" })).toBe(true);
    expect(isAppView({ screen: "memory", branch: "flow", project: "AIPASS" })).toBe(false);
  });
});
