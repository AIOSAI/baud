import { describe, expect, it } from "vitest";

import type { LookAt, LookKind } from "../messages";
import { TabBook, isPageUrl } from "./tabBook";

const look = (kind: LookKind, text: string): LookAt => ({ kind, text, title: "T", page: "https://a/", pinned: kind === "pin" });

describe("Interact rules", () => {
  it("is http(s) only", () => {
    expect(isPageUrl("https://a.com")).toBe(true);
    expect(isPageUrl("http://a.com")).toBe(true);
    expect(isPageUrl("chrome://extensions")).toBe(false);
    expect(isPageUrl("file:///x")).toBe(false);
    expect(isPageUrl(undefined)).toBe(false);
  });

  it("defaults off, needs a script, toggles, and goes off on navigate", () => {
    const b = new TabBook();
    expect(b.isOn(1)).toBe(false);
    expect(b.toggle(1, false)).toBe(false);
    expect(b.toggle(1, true)).toBe(true);
    expect(b.anyOn).toBe(true);
    b.gone(9, 1); // reload, navigate or close: the port drops
    expect(b.isOn(1)).toBe(false);
    expect(b.toggle(1, true)).toBe(true);
    expect(b.toggle(1, true)).toBe(false);
  });
});

describe("Looking-at lines", () => {
  it("drops lines from a tab with Interact off, but always lets the owner clear", () => {
    const b = new TabBook();
    expect(b.look(9, 1, look("pointer", "x"))).toBe(false);
    b.toggle(1, true);
    expect(b.look(9, 1, look("pointer", "x"))).toBe(true);
    b.off(1);
    expect(b.look(9, 1, look("pointer", ""))).toBe(true);
    expect(b.current(9)).toEqual([]);
  });

  it("keeps one pin per window: an old tab's clear never wipes the new pin", () => {
    const b = new TabBook();
    b.toggle(1, true);
    b.toggle(2, true);
    b.look(9, 1, look("pin", "first"));
    b.look(9, 2, look("pin", "second"));
    expect(b.look(9, 1, look("pin", ""))).toBe(false);
    expect(b.current(9)).toEqual([look("pin", "second")]);
    expect(b.drop(9, "pin")).toEqual([look("pin", "")]);
    expect(b.current(9)).toEqual([]);
  });

  it("clears a gone tab's lines and a stale pointer when another tab activates", () => {
    const b = new TabBook();
    b.toggle(1, true);
    b.toggle(2, true);
    b.look(9, 1, look("pointer", "p1"));
    b.look(9, 1, look("selection", "s1"));
    b.look(9, 2, look("pin", "pin2"));
    expect(b.activated(9, 1)).toEqual([]);
    expect(b.activated(9, 2)).toEqual([look("pointer", "")]);
    expect(b.gone(9, 1)).toEqual([look("selection", "")]);
    expect(b.current(9)).toEqual([look("pin", "pin2")]);
  });
});
