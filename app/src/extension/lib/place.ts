/** The orb's place on a site: one storage key per origin, clamped into the viewport on return. */

export interface Place {
  left: number;
  top: number;
}

/** One key per site, so two sites' tabs saving at once never overwrite each other. */
export const placeKey = (origin: string) => `overlay:${origin}`;

export function clampPlace(p: Place, view: { width: number; height: number }, box: { width: number; height: number }): Place {
  const fit = (v: number, room: number) => Math.max(0, Math.min(Number(v) || 0, room));
  return { left: fit(p.left, view.width - box.width), top: fit(p.top, view.height - box.height) };
}
