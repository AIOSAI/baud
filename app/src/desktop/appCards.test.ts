import { describe, expect, it } from "vitest";

import { APP_CARDS, MACHINE_TILES, appCardTitle, appCardView } from "./appCards";
import { phoneTabKey } from "./phoneView";

describe("appCardView", () => {
  it("names the seated project for git, files and backup", () => {
    expect(appCardView("git", "aipass")).toEqual({ screen: "git", project: "aipass" });
    expect(appCardView("files", "baud")).toEqual({ screen: "files", project: "baud" });
    expect(appCardView("backup", "baud")).toEqual({ screen: "backup", project: "baud" });
  });

  it("names no project for the machine-wide apps", () => {
    expect(appCardView("machine", "aipass")).toEqual({ screen: "machine" });
    expect(appCardView("browser", "aipass")).toEqual({ screen: "browser" });
  });

  it("opens nothing before the seat is read", () => {
    for (const card of APP_CARDS) expect(appCardView(card.screen, null)).toBeNull();
  });
});

describe("APP_CARDS", () => {
  it("is GIT, FILES, BACKUP, MACHINE, BROWSER, each its own tab", () => {
    expect(APP_CARDS.map((card) => card.name)).toEqual(["GIT", "FILES", "BACKUP", "MACHINE", "BROWSER"]);
    const keys = APP_CARDS.map((card) => phoneTabKey(appCardView(card.screen, "p")!));
    expect(new Set(keys).size).toBe(5);
  });

  it("titles a disabled card with why", () => {
    expect(appCardTitle(APP_CARDS[0], null)).toContain("seat is read");
    expect(appCardTitle(APP_CARDS[0], "aipass")).toContain("aipass");
  });

  it("titles the browser for this machine, not the seat", () => {
    const browser = APP_CARDS.find((card) => card.screen === "browser")!;
    expect(appCardTitle(browser, "aipass")).toContain("(this machine)");
  });
});

describe("MACHINE_TILES", () => {
  it("covers the seven monitor keys once each", () => {
    expect(MACHINE_TILES.map((tile) => tile.key)).toEqual([
      "mon-cpu",
      "mon-mem",
      "mon-temp",
      "mon-fan",
      "mon-net",
      "mon-proc",
      "mon-bat",
    ]);
  });
});
