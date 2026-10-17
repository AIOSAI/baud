import { describe, expect, it } from "vitest";

import type { BranchStatus } from "../../types";
import { type Stop, TRAIL_CAP, backWord, leave, stepBack } from "./trail";

const card = (ref: string): Stop => ({ kind: "card", ref });
const held = { name: "devpulse", project: "aipass" } as BranchStatus;
const passport: Stop = { kind: "passport", ref: "aipass/devpulse", held };

describe("leave", () => {
  it("puts the screen being left on the end, newest last", () => {
    expect(leave([], card("aipass/devpulse"))).toEqual([card("aipass/devpulse")]);
    expect(leave([card("aipass/devpulse")], passport)).toEqual([card("aipass/devpulse"), passport]);
  });

  it("returns a new list and leaves the one it was given alone", () => {
    const before: Stop[] = [card("aipass/devpulse")];
    const after = leave(before, { kind: "roots" });
    expect(after).not.toBe(before);
    expect(before).toEqual([card("aipass/devpulse")]);
  });

  it("keeps the newest TRAIL_CAP stops and drops the oldest past it", () => {
    let trail: Stop[] = [];
    for (let at = 0; at <= TRAIL_CAP; at += 1) trail = leave(trail, card(`p/${at}`));
    expect(trail.length).toBe(TRAIL_CAP);
    expect(trail[0]).toEqual(card("p/1"));
    expect(trail[TRAIL_CAP - 1]).toEqual(card(`p/${TRAIL_CAP}`));
  });

  it("keeps exactly TRAIL_CAP stops without dropping one", () => {
    let trail: Stop[] = [];
    for (let at = 0; at < TRAIL_CAP; at += 1) trail = leave(trail, card(`p/${at}`));
    expect(trail.length).toBe(TRAIL_CAP);
    expect(trail[0]).toEqual(card("p/0"));
  });
});

describe("stepBack", () => {
  it("reopens the newest stop and takes it off the trail", () => {
    const { to, rest } = stepBack([card("aipass/devpulse"), passport]);
    expect(to).toEqual(passport);
    expect(rest).toEqual([card("aipass/devpulse")]);
  });

  it("lands on the wheel from an empty trail", () => {
    expect(stepBack([])).toEqual({ to: null, rest: [] });
  });

  it("walks a card door's round trip back to the card and then the wheel", () => {
    const opened = leave([], card("aipass/devpulse"));
    const first = stepBack(opened);
    expect(first.to).toEqual(card("aipass/devpulse"));
    expect(stepBack(first.rest)).toEqual({ to: null, rest: [] });
  });

  it("leaves the trail it was given alone", () => {
    const trail: Stop[] = [card("aipass/devpulse")];
    stepBack(trail);
    expect(trail).toEqual([card("aipass/devpulse")]);
  });
});

describe("backWord", () => {
  it("names the wheel when nothing is on the trail", () => {
    expect(backWord([])).toBe("wheel");
  });

  it("names the card, the roster and the passport by the newest stop", () => {
    expect(backWord([card("aipass/devpulse")])).toBe("card");
    expect(backWord([{ kind: "roots" }])).toBe("roster");
    expect(backWord([card("aipass/devpulse"), passport])).toBe("passport");
    expect(backWord([passport, card("aipass/devpulse")])).toBe("card");
  });
});
