/** What a phone-screen tab shows, and the key that makes each one a single tab. */

import type { MemoryTabId } from "../phone/MemoryScreen";

/** The four apps on the strip: one tab each, whatever the seat. */
export type AppView =
  | { screen: "git"; project: string }
  | { screen: "files"; project: string }
  | { screen: "backup"; project: string }
  | { screen: "machine" };

/** A card's doors: one tab per agent and door, the agent named with its project. */
export type CardView =
  | { screen: "inbox"; branch: string; project: string; openId?: string }
  | { screen: "plans"; branch: string; project: string }
  | { screen: "memory"; branch: string; project: string; initialTab?: MemoryTabId }
  | { screen: "branch-git"; branch: string; project: string }
  | { screen: "branch-files"; branch: string; project: string };

export type PhoneView = AppView | CardView;

export const APP_SCREENS: ReadonlySet<PhoneView["screen"]> = new Set(["git", "files", "backup", "machine"]);

export function isAppView(view: PhoneView): view is AppView {
  return APP_SCREENS.has(view.screen);
}

/** `app:<name>` for an app; `<door>:<project>/<branch>` for a card, so two projects' same-named agents never share. */
export function phoneTabKey(view: PhoneView): string {
  if (isAppView(view)) return `app:${view.screen}`;
  return `${view.screen}:${view.project}/${view.branch}`;
}

/** The tab bar's `<branch>/<name>` pair. */
export function phoneTabLabel(view: PhoneView): { branch: string; name: string } {
  if (isAppView(view)) return { branch: "app", name: view.screen };
  const name = view.screen === "branch-git" ? "git" : view.screen === "branch-files" ? "files" : view.screen;
  return { branch: view.branch, name };
}
