import type { HarkState } from "../types";

/** The verb a click runs: muted stops too, since Codex's mute keeps the mic device open and `/voice` would stop anyway. */
export const harkVerb = (state: HarkState): "on" | "stop" | null =>
  state === "absent" ? null : state === "stopped" ? "on" : "stop";

/** The chip's tooltip: the state, since when, and what a click does. */
export function harkTitle(state: HarkState, since: string): string {
  switch (state) {
    case "listening":
      return `Hark listening since ${since} - click to stop and release the mic`;
    case "muted":
      return `Hark muted since ${since}, mic still held - click to stop and release it`;
    case "stopped":
      return `Hark off since ${since} - click to listen`;
    case "absent":
      return "no hark room - open with drone @hark standby";
  }
}
