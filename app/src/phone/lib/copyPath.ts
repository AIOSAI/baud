/** The copy button's path and lane. Paths are absolute (server floor plus row relative) because a relative path pasted into an agent's prompt resolves wherever that agent stands. */

// A floor of `/` is truthy, so `filter(Boolean).join("/")` would build `//notes.md`; trailing slashes are stripped instead.
export function machinePath(floor: string | undefined, relative: string): string {
  if (!floor) return "";
  const base = floor.replace(/\/+$/, "");
  if (!relative) return base || "/";
  return `${base}/${relative}`;
}

export function underRoot(ref: string): string {
  const cut = ref.indexOf("/");
  return cut < 0 ? "" : ref.slice(cut + 1);
}

export const COPY_REFUSED =
  "the browser refused the clipboard - nothing was copied, so nothing is claimed";

export const NO_FLOOR =
  "the server did not say where this root stands - a relative path alone would resolve somewhere else";

export type CopyLane = "clipboard" | "legacy" | "refused";

export interface CopyReport {
  note: string;
  showText: boolean;
}

/** The truthful sentence for one copy attempt: over plain http `execCommand` can say yes and land nothing, so only the clipboard lane is a confirmed copy. */
export function copyReport(lane: CopyLane, what: string): CopyReport {
  if (lane === "clipboard") {
    return { note: `copied ${what} - the clipboard confirmed it`, showText: false };
  }
  if (lane === "legacy") {
    return {
      note: `the browser says it copied ${what}, but over plain http it can say that and copy nothing - if paste comes up empty, long-press the text below and choose Copy`,
      showText: true,
    };
  }
  return {
    note: `not copied - the browser refused both clipboard lanes. Long-press the text below and choose Copy`,
    showText: true,
  };
}

export interface CopyShown {
  copied: boolean;
  note: string | null;
  byHand: string | null;
}

export function copyShown(lane: CopyLane, text: string): CopyShown {
  const report = copyReport(lane, "the path");
  if (!report.showText) return { copied: true, note: null, byHand: null };
  return { copied: false, note: report.note, byHand: text };
}

// On Android Chrome over plain http `navigator.clipboard` is undefined, so the legacy lane is the one that matters.
// Trap: `execCommand` only works inside the tap's gesture and awaiting ends it, so the absent-API case must never await.
export async function copyThrough(text: string): Promise<CopyLane> {
  if (!text) return "refused";

  const modern = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!modern || typeof modern.writeText !== "function") return legacyCopy(text) ? "legacy" : "refused";

  try {
    await modern.writeText(text);
    return "clipboard";
  } catch {
    return legacyCopy(text) ? "legacy" : "refused";
  }
}

// Path buttons use `copyShown` instead: a legacy yes is not a confirmed copy.
export async function copyText(text: string): Promise<boolean> {
  return (await copyThrough(text)) !== "refused";
}

// `readonly` + `inputMode="none"` keep Android's keyboard down; transparent, not `display:none`: a box with no layout selects nothing.
function legacyCopy(text: string): boolean {
  const held = document.activeElement;
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.inputMode = "none";
  box.style.position = "fixed";
  box.style.top = "0";
  box.style.left = "0";
  box.style.width = "1px";
  box.style.height = "1px";
  box.style.padding = "0";
  box.style.border = "none";
  box.style.opacity = "0";
  document.body.appendChild(box);

  let landed = false;
  try {
    box.select();
    // iOS ignores `select()` on a readonly box; the range is what it reads.
    box.setSelectionRange(0, text.length);
    landed = document.execCommand("copy");
  } catch {
    landed = false;
  } finally {
    box.remove();
    // The row that was tapped keeps its focus ring - the copy borrowed it.
    if (held instanceof HTMLElement) held.focus();
  }
  return landed;
}
