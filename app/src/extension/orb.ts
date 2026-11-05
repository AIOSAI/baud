/* The corner orb, drawn on a canvas in the deck's 400 px frame: glow, ring 1, the core arcs, the fleet on its rings,
   the turning particle sphere and the heart with its eyes. No mic, no music. */

import { energy } from "./lib/orbState";
import type { OrbMode, Ring } from "./messages";

export interface OrbFrame {
  mode: OrbMode;
  speaker: number;
  hue: number;
  rings: Ring[];
}

const N = 300;
const BINS = 6;
const POINTS = Array.from({ length: N }, (_, i) => {
  const y = 1 - (i / (N - 1)) * 2;
  const r = Math.sqrt(1 - y * y);
  const ph = i * 2.399963;
  return [Math.cos(ph) * r, y, Math.sin(ph) * r] as const;
});

/** draw(state, t, look) eases the eyes toward look and answers whether they are still moving. */
export function makeOrb(canvas: HTMLCanvasElement) {
  const c = canvas.getContext("2d")!;
  const bins: number[][] = Array.from({ length: BINS }, () => []);
  const eye = [0, 0];
  let level = 0;

  return (s: OrbFrame, t: number, look: readonly number[] = [0, 0]): boolean => {
    level += (energy(s.mode, s.speaker, t) - level) * 0.15;
    const S = canvas.width;
    const k = S / 400;
    const o = S / 2;
    const H = s.hue;
    const busy = s.mode !== "idle";
    const rot = t * (s.mode === "thinking" ? 1.2 : 0.35);
    const R = 95 * k * (1 + level * 0.6 + 0.04 * Math.sin(t * 1.5));
    c.clearRect(0, 0, S, S);

    const glow = c.createRadialGradient(o, o, R * 0.2, o, o, R * 1.6);
    glow.addColorStop(0, `hsla(${H} 90% 60% / ${0.15 + level * 0.3})`);
    glow.addColorStop(1, "transparent");
    c.fillStyle = glow;
    c.fillRect(0, 0, S, S);

    const amp = k * ((busy ? 2 : 0) + 16 * level);
    const r1 = (a: number) => R + 22 * k + amp * Math.sin(a * 9 + t * 6) * Math.sin(a * 4 - t * 3);
    c.lineWidth = 1.5 * k;
    c.strokeStyle = `hsla(${H} 85% 65% / ${busy ? 0.7 : 0.45})`;
    c.beginPath();
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      c.lineTo(o + r1(a) * Math.cos(a), o + r1(a) * Math.sin(a));
    }
    c.stroke();

    c.lineWidth = 2 * k;
    c.strokeStyle = `hsla(${H} 90% 75% / .8)`;
    c.beginPath();
    c.arc(o, o, R + 40 * k, -t / 1.4, -t / 1.4 + Math.PI / 2);
    c.stroke();
    c.strokeStyle = `hsla(${H} 90% 75% / .25)`;
    c.beginPath();
    c.arc(o, o, R + 40 * k, -t / 1.4 + Math.PI / 2, -t / 1.4 + Math.PI);
    c.stroke();
    c.setLineDash([2 * k, 8 * k]);
    c.strokeStyle = `hsla(${H} 90% 70% / .3)`;
    c.beginPath();
    c.arc(o, o, R + 58 * k, t / 10, t / 10 + 7);
    c.stroke();
    c.setLineDash([]);

    // ring 2 green per live session, ring 3 orange per dispatched agent, the outer ring violet per sub-agent; working dots pulse
    const ringDots = (r: number, list: { working: boolean }[], color: (on: number) => string, spin: number, size: number) =>
      list.forEach((a, i) => {
        const ang = spin + (i / list.length) * Math.PI * 2;
        const on = a.working ? 0.35 + 0.65 * Math.abs(Math.sin(t * 4 + i)) : 0.9;
        c.fillStyle = color(on);
        c.beginPath();
        c.arc(o + r * Math.cos(ang), o + r * Math.sin(ang), size * k, 0, 7);
        c.fill();
      });
    ringDots(R + 40 * k, s.rings.filter((a) => !a.dispatched), (on) => `hsla(140 85% 60% / ${on})`, -t / 1.4, 3.5);
    ringDots(R + 58 * k, s.rings.filter((a) => a.dispatched), (on) => `hsla(30 95% 60% / ${on})`, t / 10, 3.5);
    c.strokeStyle = `hsla(${H} 90% 70% / .18)`;
    c.beginPath();
    c.arc(o, o, R + 74 * k, 0, 7);
    c.stroke();
    const subs = s.rings.flatMap((a) => Array(a.subagents).fill({ working: true }));
    ringDots(R + 74 * k, subs, (on) => `hsla(275 90% 72% / ${on})`, t / 6, 3);

    for (const b of bins) b.length = 0;
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    for (const [x, y, z] of POINTS) {
      const X = x * cr - z * sr;
      const Z = x * sr + z * cr;
      const jit = 1 + level * 0.5 * Math.sin(y * 9 + t * 5) * Math.sin(X * 7 + t * 3);
      bins[Math.min(BINS - 1, Math.floor(((Z + 1) / 2) * BINS))].push(o + X * R * jit, o + y * R * jit);
    }
    bins.forEach((b, j) => {
      const depth = (j + 0.5) / BINS;
      const r = (1.5 + 3 * depth) * k;
      c.fillStyle = `hsla(${H} 90% ${70 + 20 * depth}% / ${0.25 + 0.6 * depth})`;
      c.beginPath();
      for (let i = 0; i < b.length; i += 2) {
        c.moveTo(b[i] + r, b[i + 1]);
        c.arc(b[i], b[i + 1], r, 0, 7);
      }
      c.fill();
    });

    const hr = 26 * k * (1 + 0.1 * Math.sin(t * 2) + level);
    const heart = c.createRadialGradient(o, o, 0, o, o, hr);
    heart.addColorStop(0, "#fff");
    heart.addColorStop(0.5, `hsl(${H} 90% 85%)`);
    heart.addColorStop(1, "transparent");
    c.fillStyle = heart;
    c.beginPath();
    c.arc(o, o, 32 * k, 0, 7);
    c.fill();

    // the eyes ease toward the pointer and blink for 140 ms every 4.7 s
    eye[0] += (look[0] - eye[0]) * 0.15;
    eye[1] += (look[1] - eye[1]) * 0.15;
    const lid = performance.now() % 4700 < 140 ? 0.15 : 1;
    const ex = o + eye[0] * 12 * k;
    const ey = o + eye[1] * 11 * k;
    c.fillStyle = "#04060f";
    for (const side of [-1, 1]) {
      c.beginPath();
      c.ellipse(ex + side * 5.5 * k, ey, 2.2 * k, 3.2 * k * lid, 0, 0, 7);
      c.fill();
    }
    return Math.hypot(look[0] - eye[0], look[1] - eye[1]) > 0.01;
  };
}
