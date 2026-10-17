import { describe, expect, it } from "vitest";

import type { BranchStatus } from "../../types";
import {
  FOCUS_CAP,
  TABS_KEY,
  TABS_VERSION,
  type StoredPane,
  type TabStorage,
  type Tabs,
  closeTab,
  focusOn,
  loadTabs,
  mergeTabs,
  restoreTabs,
  saveTabs,
} from "./tabStore";

/** A Storage stand-in: the two calls the store uses, over a plain map. */
function store(seed: Record<string, string> = {}): TabStorage & { held: Record<string, string> } {
  const held = { ...seed };
  return {
    held,
    getItem: (key) => (key in held ? held[key] : null),
    setItem: (key, value) => {
      held[key] = value;
    },
  };
}

/** PhoneApp's key, in miniature: enough to tell the panes below apart. */
const keyOf = (pane: StoredPane) =>
  pane.mode === "file" ? `file:${pane.project ?? ""}/${pane.ref}` : `${pane.mode}:${pane.project ?? ""}/${pane.name}`;
const isSeat = (pane: StoredPane) => pane.mode === "resume" || pane.mode === "fresh";

const cardOf = (name: string, project: string, extra: Partial<BranchStatus> = {}) =>
  ({ name, project, path: `/p/${name}`, interactive: false, ...extra }) as BranchStatus;

const room: StoredPane = { name: "devpulse", mode: "resume", project: "aipass", card: cardOf("devpulse", "aipass") };
const shell: StoredPane = { name: "", mode: "shell", project: "aipass" };
const file: StoredPane = {
  name: "baud",
  mode: "file",
  ref: "baud/README.md",
  project: "aipass",
  from: { name: "baud", project: "aipass", start: "", at: "docs" },
  fromTrail: [{ kind: "card", ref: "aipass/baud" }],
};

describe("focusOn", () => {
  it("moves a fronted key to the end and keeps it once", () => {
    expect(focusOn(["a", "b", "c"], "a")).toEqual(["b", "c", "a"]);
    expect(focusOn([], "a")).toEqual(["a"]);
  });

  it("keeps the newest FOCUS_CAP keys", () => {
    let focus: string[] = [];
    for (let at = 0; at <= FOCUS_CAP; at += 1) focus = focusOn(focus, `k${at}`);
    expect(focus.length).toBe(FOCUS_CAP);
    expect(focus[0]).toBe("k1");
    expect(focus[FOCUS_CAP - 1]).toBe(`k${FOCUS_CAP}`);
  });

  it("keeps exactly FOCUS_CAP keys without dropping one", () => {
    let focus: string[] = [];
    for (let at = 0; at < FOCUS_CAP; at += 1) focus = focusOn(focus, `k${at}`);
    expect(focus[0]).toBe("k0");
  });
});

describe("closeTab", () => {
  it("fronts the tab fronted before the closed one, not the rightmost", () => {
    // Row a b c, fronted a, then c, then b. Closing b fronts c, the one
    // fronted before it; closing c then fronts a.
    const first = closeTab(["a", "b", "c"], ["a", "c", "b"], "b", "b");
    expect(first).toEqual({ active: "c", focus: ["a", "c"] });
    expect(closeTab(["a", "c"], first.focus, "c", "c")).toEqual({ active: "a", focus: ["a"] });
  });

  it("fronts the previously active tab when the rightmost is a different one", () => {
    // Row room, file1, file2; the operator went room -> file2 -> room -> file1.
    expect(closeTab(["room", "file1", "file2"], ["file2", "room", "file1"], "file1", "file1")).toEqual({
      active: "room",
      focus: ["file2", "room"],
    });
  });

  it("leaves the front tab alone when a tab behind it closes", () => {
    expect(closeTab(["a", "b", "c"], ["a", "b"], "b", "c")).toEqual({ active: "b", focus: ["a", "b"] });
  });

  it("falls back to the rightmost tab when the history holds nothing still open", () => {
    expect(closeTab(["a", "b", "c"], ["gone", "b"], "b", "b")).toEqual({ active: "c", focus: [] });
  });

  it("fronts nothing when the last tab closes", () => {
    expect(closeTab(["a"], ["a"], "a", "a")).toEqual({ active: null, focus: [] });
  });

  it("drops keys no longer in the row from the history", () => {
    expect(closeTab(["a", "b"], ["x", "a", "b"], "a", "b").focus).toEqual(["a"]);
  });
});

describe("saveTabs and loadTabs", () => {
  it("brings back the row, the front tab and the history, every pane marked restored", () => {
    const disk = store();
    saveTabs(disk, { open: [room, shell, file], active: keyOf(file), focus: [keyOf(room), keyOf(file)] });
    const back = loadTabs(disk, keyOf);
    expect(back).toEqual({
      open: [
        { ...room, restored: true },
        { ...shell, restored: true },
        { ...file, restored: true },
      ],
      active: keyOf(file),
      focus: [keyOf(room), keyOf(file)],
    });
  });

  it("stores the one-shot command and the restore mark of no pane", () => {
    const disk = store();
    saveTabs(disk, { open: [{ ...shell, command: "drone @baud --help", restored: true }], active: null, focus: [] });
    const written = JSON.parse(disk.held[TABS_KEY]) as { v: number; open: StoredPane[] };
    expect(written.v).toBe(TABS_VERSION);
    expect(written.open).toEqual([shell]);
  });

  it("reads nothing from an empty store, a broken blob or another version", () => {
    expect(loadTabs(store(), keyOf)).toBe(null);
    expect(loadTabs(store({ [TABS_KEY]: "{not json" }), keyOf)).toBe(null);
    expect(loadTabs(store({ [TABS_KEY]: JSON.stringify({ v: 99, open: [shell] }) }), keyOf)).toBe(null);
    expect(loadTabs(store({ [TABS_KEY]: JSON.stringify({ v: TABS_VERSION, open: "x" }) }), keyOf)).toBe(null);
  });

  it("drops a pane that is not one and keeps the rest", () => {
    const blob = {
      v: TABS_VERSION,
      open: [
        shell,
        { name: 3, mode: "shell" },
        { name: "x", mode: "launch" },
        { name: "x", mode: "file" },
        { name: "x", mode: "file", ref: "x/a", document: "poster" },
        { name: "x", mode: "file", ref: "x/a", from: { name: "x" } },
        { name: "x", mode: "file", ref: "x/a", fromTrail: "card" },
        { name: "x", mode: "watch", card: { name: 1 } },
        { name: "x", mode: "watch", project: 7 },
        null,
      ],
      active: null,
      focus: [],
    };
    const back = loadTabs(store({ [TABS_KEY]: JSON.stringify(blob) }), keyOf);
    expect(back?.open).toEqual([{ ...shell, restored: true }]);
  });

  it("reads nothing when no pane survives", () => {
    const blob = { v: TABS_VERSION, open: [{ name: 3 }], active: null, focus: [] };
    expect(loadTabs(store({ [TABS_KEY]: JSON.stringify(blob) }), keyOf)).toBe(null);
  });

  it("fronts the newest fronted tab when the stored front tab is gone, then the rightmost", () => {
    const blob = { v: TABS_VERSION, open: [room, shell], active: "nope", focus: ["gone", keyOf(room)] };
    const kept = loadTabs(store({ [TABS_KEY]: JSON.stringify(blob) }), keyOf);
    expect(kept?.active).toBe(keyOf(room));
    expect(kept?.focus).toEqual([keyOf(room)]);
    const bare = { v: TABS_VERSION, open: [room, shell], active: 5 };
    const back = loadTabs(store({ [TABS_KEY]: JSON.stringify(bare) }), keyOf);
    expect(back?.active).toBe(keyOf(shell));
    expect(back?.focus).toEqual([]);
  });

  it("keeps the session going when storage refuses", () => {
    const refusing: TabStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => saveTabs(refusing, { open: [shell], active: null, focus: [] })).not.toThrow();
    expect(loadTabs(refusing, keyOf)).toBe(null);
  });
});

describe("restoreTabs", () => {
  const restoredRow = (open: StoredPane[], active: string | null = null): Tabs<StoredPane> => ({
    open,
    active,
    focus: open.map(keyOf),
  });

  it("takes each agent's card fresh from the census", () => {
    const fresh = cardOf("devpulse", "aipass", { interactive: true });
    const back = restoreTabs(restoredRow([room]), { seat: "aipass", seated: [fresh], roster: null }, keyOf);
    expect(back.open).toEqual([{ ...room, card: fresh }]);
    expect(back.dropped).toEqual([]);
  });

  it("drops a tab whose agent left the seated census, with one line", () => {
    const back = restoreTabs(restoredRow([room, shell], keyOf(room)), { seat: "aipass", seated: [], roster: [] }, keyOf);
    expect(back.open).toEqual([shell]);
    expect(back.dropped).toEqual(["restored tab dropped: devpulse has no card in aipass now"]);
    expect(back.active).toBe(keyOf(shell));
    expect(back.focus).toEqual([keyOf(shell)]);
  });

  it("finds another project's agent on the roster, and drops it when the roster has none", () => {
    const away: StoredPane = { name: "canary", mode: "watch", project: "chess" };
    const there = cardOf("canary", "chess");
    const kept = restoreTabs(restoredRow([away]), { seat: "aipass", seated: [], roster: [there] }, keyOf);
    expect(kept.open).toEqual([{ ...away, card: there }]);
    const gone = restoreTabs(restoredRow([away]), { seat: "aipass", seated: [], roster: [] }, keyOf);
    expect(gone.open).toEqual([]);
    expect(gone.dropped).toEqual(["restored tab dropped: canary has no card in chess now"]);
  });

  it("never matches a same-named agent in another project", () => {
    const away: StoredPane = { name: "devpulse", mode: "watch", project: "chess" };
    const back = restoreTabs(restoredRow([away]), { seat: "aipass", seated: [cardOf("devpulse", "aipass")], roster: [] }, keyOf);
    expect(back.open).toEqual([]);
  });

  it("keeps a tab on its stored card when the list it belongs to did not answer", () => {
    const away: StoredPane = { name: "canary", mode: "watch", project: "chess" };
    const back = restoreTabs(restoredRow([room, away]), { seat: "aipass", seated: null, roster: null }, keyOf);
    expect(back.open).toEqual([room, away]);
    expect(back.dropped).toEqual([]);
  });

  it("judges another project's tab by the roster alone, never by the seat's read", () => {
    const away: StoredPane = { name: "canary", mode: "watch", project: "chess" };
    const unasked = restoreTabs(restoredRow([away]), { seat: "aipass", seated: [], roster: null }, keyOf);
    expect(unasked.open).toEqual([away]);
    const answered = restoreTabs(restoredRow([away]), { seat: "aipass", seated: null, roster: [] }, keyOf);
    expect(answered.open).toEqual([]);
  });

  it("keeps files and the panes that name no agent as they are", () => {
    const watch: StoredPane = { name: "", mode: "watch" };
    const back = restoreTabs(restoredRow([file, shell, watch]), { seat: "aipass", seated: [], roster: [] }, keyOf);
    expect(back.open).toEqual([file, shell, watch]);
  });

  it("reads an unnamed project as the seat", () => {
    const seated: StoredPane = { name: "devpulse", mode: "resume", project: "" };
    const fresh = cardOf("devpulse", "aipass");
    const back = restoreTabs(restoredRow([seated]), { seat: "aipass", seated: [fresh], roster: null }, keyOf);
    expect(back.open).toEqual([{ ...seated, card: fresh }]);
  });

  it("names the seated project when the seat itself has no name", () => {
    const seated: StoredPane = { name: "devpulse", mode: "resume", project: "" };
    const back = restoreTabs(restoredRow([seated]), { seat: "", seated: [], roster: null }, keyOf);
    expect(back.dropped).toEqual(["restored tab dropped: devpulse has no card in the seated project now"]);
  });
});

describe("mergeTabs", () => {
  const hand: StoredPane = { name: "", mode: "shell", project: "chess" };
  const handRoom: StoredPane = { name: "canary", mode: "fresh", project: "aipass" };

  it("puts the restored row first and what hands opened after it, hands in front", () => {
    const merged = mergeTabs(
      { open: [room, file], active: keyOf(file), focus: [keyOf(room), keyOf(file)] },
      { open: [hand], active: keyOf(hand), focus: [keyOf(hand)] },
      keyOf,
      isSeat,
    );
    expect(merged.open).toEqual([room, file, hand]);
    expect(merged.active).toBe(keyOf(hand));
    expect(merged.focus).toEqual([keyOf(room), keyOf(file), keyOf(hand)]);
  });

  it("keeps the restored front tab when hands opened nothing", () => {
    const merged = mergeTabs(
      { open: [room, file], active: keyOf(room), focus: [keyOf(file), keyOf(room)] },
      { open: [], active: null, focus: [] },
      keyOf,
      isSeat,
    );
    expect(merged).toEqual({ open: [room, file], active: keyOf(room), focus: [keyOf(file), keyOf(room)] });
  });

  it("lets a seat the hands took outrank the restored one", () => {
    const merged = mergeTabs(
      { open: [room, shell], active: keyOf(room), focus: [keyOf(room)] },
      { open: [handRoom], active: keyOf(handRoom), focus: [keyOf(handRoom)] },
      keyOf,
      isSeat,
    );
    expect(merged.open).toEqual([shell, handRoom]);
    expect(merged.active).toBe(keyOf(handRoom));
    expect(merged.focus).toEqual([keyOf(handRoom)]);
  });

  it("keeps one pane per key, the hand's", () => {
    const again = { ...shell, restored: undefined };
    const merged = mergeTabs(
      { open: [{ ...shell, restored: true }], active: keyOf(shell), focus: [keyOf(shell)] },
      { open: [again], active: keyOf(again), focus: [keyOf(again)] },
      keyOf,
      isSeat,
    );
    expect(merged.open).toEqual([again]);
  });

  it("fronts the rightmost when neither side names a front tab still open", () => {
    const merged = mergeTabs(
      { open: [shell, file], active: "gone", focus: [] },
      { open: [], active: null, focus: [] },
      keyOf,
      isSeat,
    );
    expect(merged.active).toBe(keyOf(file));
  });
});
