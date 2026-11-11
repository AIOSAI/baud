/* The corner pulse, drawn on a canvas in a 100-unit frame: a signal dot, a row of bars that run with the
   fleet's energy, and one tick per live agent underneath. Terminal green on BAUD's dark ground. */

import { tokens } from "../tokens";
import { energy } from "./lib/pulseState";
import type { PulseMode, Ring } from "./messages";

export interface PulseFrame {
  mode: PulseMode;
  speaker: number;
  rings: Ring[];
}

const BARS = 9;
const RATE: Record<PulseMode, number> = { idle: 1.2, listening: 2.5, thinking: 3.5, acting: 8, speaking: 6 };

export function makePulse(canvas: HTMLCanvasElement) {
  const c = canvas.getContext("2d")!;
  let level = 0;

  return (s: PulseFrame, t: number) => {
    level += (energy(s.mode, s.speaker, t) - level) * 0.2;
    const u = canvas.width / 100;
    const busy = s.mode !== "idle";
    c.clearRect(0, 0, canvas.width, canvas.height);

    c.strokeStyle = tokens.line;
    c.lineWidth = u;
    c.beginPath();
    c.moveTo(10 * u, 62 * u);
    c.lineTo(90 * u, 62 * u);
    c.stroke();

    // the dot: a slow breath when idle, a steady beat with the bars when busy
    const beat = 0.5 + 0.5 * Math.sin(t * RATE[s.mode]);
    c.fillStyle = tokens.green;
    c.globalAlpha = busy ? 0.75 + 0.25 * beat : 0.3 + 0.3 * beat;
    c.beginPath();
    c.arc(18 * u, 40 * u, (5 + 3 * level) * u, 0, Math.PI * 2);
    c.fill();

    for (let i = 0; i < BARS; i++) {
      const wave = 0.5 + 0.5 * Math.sin(t * RATE[s.mode] - i * 0.9);
      const h = Math.min(44, 3 + 80 * level * wave) * u;
      c.globalAlpha = busy ? 0.55 + 0.45 * wave : 0.25 + 0.2 * wave;
      c.fillRect((32 + i * 6.5) * u, 40 * u - h / 2, 3.5 * u, h);
    }

    // one tick per agent: live green, dispatched amber; working ones lit, sub-agents as dots below
    const n = s.rings.length;
    const step = n ? Math.min(9, 80 / n) : 0;
    s.rings.forEach((r, i) => {
      const x = (10 + i * step) * u;
      c.fillStyle = r.dispatched ? tokens.amber : tokens.green;
      c.globalAlpha = r.working ? 0.7 + 0.3 * Math.abs(Math.sin(t * 4 + i)) : 0.3;
      c.fillRect(x, 70 * u, (step - 2) * u, 4 * u);
      for (let k = 0; k < Math.min(r.subagents, 4); k++) c.fillRect(x + k * 2 * u, 78 * u, u, u);
    });
    c.globalAlpha = 1;
  };
}
