/** The wheel's desktop input as data: which keys and wheel turns move a card or a layer. Reference: docs/phone/wheel.md */

/** One card along the rail, one layer through the stack, or open the centred card. */
export type WheelStep = { card: number } | { layer: number } | "open";

/** A quiet gap longer than this starts a new wheel gesture; inside it a trackpad's inertia stream is one step. */
export const WHEEL_REST_MS = 220;

/** Down is the next layer, as a finger's upward swipe is on the phone. Null leaves the key to the browser. */
export function keyStep(key: string): WheelStep | null {
  switch (key) {
    case "ArrowLeft":
      return { card: -1 };
    case "ArrowRight":
      return { card: 1 };
    case "ArrowUp":
      return { layer: -1 };
    case "ArrowDown":
      return { layer: 1 };
    case "Enter":
      return "open";
    default:
      return null;
  }
}

/** Shift turns the wheel into cards; a sideways-dominant pan is null so the rail's own scroll-snap keeps it. */
export function wheelStep(turn: { deltaX: number; deltaY: number; shiftKey: boolean }): WheelStep | null {
  const { deltaX, deltaY, shiftKey } = turn;
  if (shiftKey) {
    // Some engines hand shift+wheel over already rotated onto deltaX.
    const along = deltaY !== 0 ? deltaY : deltaX;
    return along === 0 ? null : { card: Math.sign(along) };
  }
  if (Math.abs(deltaY) <= Math.abs(deltaX)) return null;
  return { layer: Math.sign(deltaY) };
}
