/** The wheel's desktop input as data: which keys and wheel turns move a card or a layer. Reference: docs/phone/wheel.md */

/** One card along the rail, one layer through the stack, or open the centred card. */
export type WheelStep = { card: number } | { layer: number } | "open";

/** How a mouse wheel or trackpad turn becomes one step: a quiet gap longer than `restMs` starts a new gesture,
 *  so a trackpad's inertia stream is one step; a gesture steps once its turn reaches `minDelta` pixels. */
export interface WheelGate {
  restMs: number;
  minDelta: number;
}

export type WheelSpeed = "slow" | "normal" | "fast";

/** `fast` steps on any turn; a mouse notch is ~100px, so no level's `minDelta` swallows one. */
export const WHEEL_SPEEDS: Readonly<Record<WheelSpeed, WheelGate>> = {
  slow: { restMs: 500, minDelta: 60 },
  normal: { restMs: 350, minDelta: 30 },
  fast: { restMs: 220, minDelta: 0 },
};

/** The window's own feel, like the zoom: localStorage, read on every turn so a change applies on the spot. */
export const WHEEL_SPEED_KEY = "baud-wheel-speed";

/** Absent or hand-edited nonsense is `normal`. */
export function wheelSpeed(stored: string | null): WheelSpeed {
  return stored !== null && Object.prototype.hasOwnProperty.call(WHEEL_SPEEDS, stored) ? (stored as WheelSpeed) : "normal";
}

/** One gesture's running state: the last event's time, the turn so far, and whether it already stepped. */
export interface WheelGesture {
  at: number;
  turned: number;
  stepped: boolean;
}

export const QUIET: WheelGesture = { at: Number.NEGATIVE_INFINITY, turned: 0, stepped: false };

/** Folds one wheel event into the gesture; `fire` is true on the one event that takes the gesture's step. */
export function gateTurn(
  held: WheelGesture,
  at: number,
  delta: number,
  gate: WheelGate,
): { gesture: WheelGesture; fire: boolean } {
  const fresh = at - held.at > gate.restMs;
  const turned = (fresh ? 0 : held.turned) + Math.abs(delta);
  const stepped = fresh ? false : held.stepped;
  const fire = !stepped && turned >= gate.minDelta;
  return { gesture: { at, turned, stepped: stepped || fire }, fire };
}

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
