/** The worker's per-tab rules, pure: Interact on/off and which tab owns each window's Looking-at lines. */

import type { LookAt, LookKind } from "../messages";

export const isPageUrl = (url: string | undefined) => /^https?:\/\//.test(url ?? "");

const cleared = (look: LookAt): LookAt => ({ ...look, text: "" });

export class TabBook {
  // shortcut: held in memory, so a worker restart turns Interact off everywhere; persist to storage.session if that bites
  private readonly interact = new Set<number>();
  private readonly lines = new Map<number, Map<LookKind, { tabId: number; look: LookAt }>>();

  isOn(tabId: number): boolean {
    return this.interact.has(tabId);
  }

  get anyOn(): boolean {
    return this.interact.size > 0;
  }

  /** Only a tab whose content script answers can be switched on: default off, http(s) only. */
  toggle(tabId: number, hasScript: boolean): boolean {
    if (!hasScript || this.interact.has(tabId)) this.interact.delete(tabId);
    else this.interact.add(tabId);
    return this.interact.has(tabId);
  }

  off(tabId: number): void {
    this.interact.delete(tabId);
  }

  /** Reload, navigate or close: the tab's script is gone, so Interact goes off and its lines are cleared for the panel. */
  gone(windowId: number, tabId: number): LookAt[] {
    this.interact.delete(tabId);
    const book = this.lines.get(windowId);
    const out: LookAt[] = [];
    for (const [kind, line] of book ?? []) {
      if (line.tabId !== tabId) continue;
      book!.delete(kind);
      out.push(cleared(line.look));
    }
    return out;
  }

  /** A tab's line: forwarded when Interact is on, and a clear only from the tab that owns that kind. */
  look(windowId: number, tabId: number, look: LookAt): boolean {
    let book = this.lines.get(windowId);
    if (!book) this.lines.set(windowId, (book = new Map()));
    const held = book.get(look.kind);
    if (!look.text) {
      if (!held || held.tabId !== tabId) return false;
      book.delete(look.kind);
      return true;
    }
    if (!this.interact.has(tabId)) return false;
    book.set(look.kind, { tabId, look });
    return true;
  }

  /** The pointer line belongs to the tab the pointer was on; a different active tab makes it stale. */
  activated(windowId: number, tabId: number): LookAt[] {
    const held = this.lines.get(windowId)?.get("pointer");
    if (!held || held.tabId === tabId) return [];
    this.lines.get(windowId)!.delete("pointer");
    return [cleared(held.look)];
  }

  /** The panel unpinned: whichever tab held the pin no longer does. */
  drop(windowId: number, kind: LookKind): LookAt[] {
    const held = this.lines.get(windowId)?.get(kind);
    if (!held) return [];
    this.lines.get(windowId)!.delete(kind);
    return [cleared(held.look)];
  }

  current(windowId: number): LookAt[] {
    return [...(this.lines.get(windowId)?.values() ?? [])].map((l) => l.look);
  }
}
