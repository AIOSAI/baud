import { describe, expect, it } from "vitest";

import { cardDoorView, holdsRoom } from "./cardDoors";
import { phoneTabKey } from "./phoneView";

const flow = { name: "flow", project: "AIPASS" };

describe("cardDoorView", () => {
  it("sends each figure to its designed screen with the card's own project", () => {
    expect(cardDoorView("inbox", flow)).toEqual({ screen: "inbox", branch: "flow", project: "AIPASS" });
    expect(cardDoorView("plans", flow)).toEqual({ screen: "plans", branch: "flow", project: "AIPASS" });
    expect(cardDoorView("todos", flow)).toEqual({
      screen: "memory",
      branch: "flow",
      project: "AIPASS",
      initialTab: "todos",
    });
    expect(cardDoorView("git", flow)).toEqual({ screen: "branch-git", branch: "flow", project: "AIPASS" });
    expect(cardDoorView("files", flow)).toEqual({ screen: "branch-files", branch: "flow", project: "AIPASS" });
  });

  it("keeps two projects' same-named agents in separate tabs", () => {
    const here = phoneTabKey(cardDoorView("inbox", { name: "flow", project: "BAUD" }));
    expect(phoneTabKey(cardDoorView("inbox", flow))).not.toBe(here);
  });
});

describe("holdsRoom", () => {
  it("matches the terminal's room only on name and project both", () => {
    expect(holdsRoom({ room: "flow", project: "AIPASS" }, flow)).toBe(true);
    expect(holdsRoom({ room: "flow", project: "BAUD" }, flow)).toBe(false);
    expect(holdsRoom({ room: "drone", project: "AIPASS" }, flow)).toBe(false);
    expect(holdsRoom(null, flow)).toBe(false);
  });
});
