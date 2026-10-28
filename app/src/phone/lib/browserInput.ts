/** DOM events to CDP Input params for the BROWSER tab's canvas, the key mapping after DevTools' InputModel. */

import type { BrowserInput } from "../../types";

interface Mods {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

interface Size {
  device_width: number;
  device_height: number;
}

/** CDP's bit order, not the DOM's. */
export const modifiersOf = (e: Mods): number =>
  (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);

/** Scaled by the frame's CSS size, never its image pixels: the JPEG is capped at 1280 and the DPR differs. */
export function pagePoint(cx: number, cy: number, shownWidth: number, shownHeight: number, frame: Size) {
  return { x: (cx * frame.device_width) / shownWidth, y: (cy * frame.device_height) / shownHeight };
}

const BUTTONS = ["left", "middle", "right", "back", "forward"];

/** A move carries the held button, or Chrome reads a drag as a hover. */
function heldButton(buttons: number): string {
  if (buttons & 1) return "left";
  if (buttons & 4) return "middle";
  if (buttons & 2) return "right";
  return "none";
}

export function mouseInput(
  type: "mousePressed" | "mouseReleased" | "mouseMoved",
  e: Mods & { button: number; buttons: number; detail: number },
  at: { x: number; y: number },
): BrowserInput {
  const moved = type === "mouseMoved";
  return {
    kind: "mouse",
    params: {
      type,
      ...at,
      modifiers: modifiersOf(e),
      button: moved ? heldButton(e.buttons) : (BUTTONS[e.button] ?? "none"),
      buttons: e.buttons,
      clickCount: moved ? 0 : Math.max(e.detail, 1),
    },
  };
}

/** Line-mode deltas (a notched wheel on some setups) become pixels at Chrome's own 40 per line. */
export function wheelInput(e: Mods & { deltaX: number; deltaY: number; deltaMode: number }, at: { x: number; y: number }): BrowserInput {
  const unit = e.deltaMode === 1 ? 40 : 1;
  return {
    kind: "mouse",
    params: { type: "mouseWheel", ...at, modifiers: modifiersOf(e), deltaX: e.deltaX * unit, deltaY: e.deltaY * unit },
  };
}

/** keydown is a keyDown plus, for printable text, a `char` carrying it; the virtual key code is what moves carets. */
export function keyInputs(
  phase: "down" | "up",
  e: Mods & { key: string; code: string; keyCode: number; repeat: boolean },
): BrowserInput[] {
  const base = {
    modifiers: modifiersOf(e),
    key: e.key,
    code: e.code,
    windowsVirtualKeyCode: e.keyCode,
    nativeVirtualKeyCode: e.keyCode,
    autoRepeat: e.repeat,
  };
  if (phase === "up") return [{ kind: "key", params: { type: "keyUp", ...base } }];
  const printable = [...e.key].length === 1 && !e.ctrlKey && !e.metaKey;
  const text = e.key === "Enter" ? "\r" : printable ? e.key : "";
  const down: BrowserInput = { kind: "key", params: { type: "keyDown", ...base } };
  return text ? [down, { kind: "key", params: { type: "char", ...base, text, unmodifiedText: text } }] : [down];
}

/** A bare host gets https; anything already naming a scheme goes as typed. */
export function urlOf(typed: string): string {
  const url = typed.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^(about|data|chrome|file|view-source):/i.test(url)
    ? url
    : `https://${url}`;
}
