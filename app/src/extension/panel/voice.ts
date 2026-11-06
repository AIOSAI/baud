/** Piper read-aloud, the deck's player on Web Audio: each PCM chunk queued straight after the last, so speech starts at
    once; one reply at a time; pause suspends the clock; back rewinds over the kept chunks. */

import { speak } from "../../host";
import { speakable } from "../lib/chat";
import { loudness, pcmSamples } from "../lib/pcm";

export interface VoiceState {
  id: string | null;
  loading: boolean;
  paused: boolean;
  error: string | null;
}

interface Chunk {
  buf: AudioBuffer;
  /** Its place in the speech, seconds. */
  off: number;
  /** Its start on the context clock. */
  when: number;
  src?: AudioBufferSourceNode;
}

interface Playing {
  ctx: AudioContext;
  an: AnalyserNode;
  abort: AbortController;
  chunks: Chunk[];
  at: number;
  last: AudioBufferSourceNode | null;
  end: (() => void) | null;
}

export function createVoice(onChange: (s: VoiceState) => void) {
  let state: VoiceState = { id: null, loading: false, paused: false, error: null };
  let cur: Playing | null = null;
  const frame = new Float32Array(512);
  const set = (patch: Partial<VoiceState>) => {
    state = { ...state, ...patch };
    onChange(state);
  };

  function stop() {
    if (cur) {
      cur.abort.abort();
      void cur.ctx.close();
      cur = null;
    }
    set({ id: null, loading: false, paused: false });
  }

  function toggle() {
    if (!cur) return; // still loading
    const paused = !state.paused;
    void (paused ? cur.ctx.suspend() : cur.ctx.resume());
    set({ paused });
  }

  const sound = (me: Playing, c: Chunk, when: number, skip = 0) => {
    const s = me.ctx.createBufferSource();
    s.buffer = c.buf;
    s.connect(me.an);
    s.start(when, skip);
    c.src = s;
    c.when = when - skip;
    return s;
  };

  function back(sec: number) {
    const me = cur;
    if (!me) return;
    const now = me.ctx.currentTime;
    const on = me.chunks.find((c) => now < c.when + c.buf.duration);
    const heard = on ? on.off + Math.max(0, now - on.when) : me.chunks.reduce((s, c) => s + c.buf.duration, 0);
    const pos = Math.max(0, heard - sec);
    for (const c of me.chunks) {
      if (!c.src) continue;
      c.src.onended = null;
      c.src.stop();
    }
    let w = now + 0.05;
    me.last = null;
    for (const c of me.chunks) {
      if (c.off + c.buf.duration <= pos) continue;
      const skip = Math.max(0, pos - c.off);
      me.last = sound(me, c, w, skip);
      w += c.buf.duration - skip;
    }
    me.at = w;
    if (me.end && me.last) me.last.onended = me.end;
  }

  async function play(id: string, text: string) {
    if (state.id === id) return toggle();
    stop();
    const abort = new AbortController();
    // Made before the first await, inside the tap: a phone keeps a context made later silent.
    const ctx = new AudioContext();
    set({ id, loading: true, paused: false, error: null });
    let got: Awaited<ReturnType<typeof speak>>;
    try {
      got = await speak(speakable(text), abort.signal);
    } catch (err) {
      void ctx.close();
      if (state.id === id && !abort.signal.aborted) set({ id: null, loading: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (state.id !== id || abort.signal.aborted) {
      void ctx.close();
      return;
    }
    const an = ctx.createAnalyser();
    an.fftSize = frame.length;
    an.connect(ctx.destination);
    const me: Playing = { ctx, an, abort, chunks: [], at: ctx.currentTime + 0.05, last: null, end: null };
    cur = me;
    set({ loading: false });
    const reader = got.body.getReader();
    let carry: Uint8Array | null = null;
    let off = 0;
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done || !value || cur !== me) break;
      const pcm = pcmSamples(carry, value);
      carry = pcm.carry;
      if (!pcm.samples.length) continue;
      const buf = ctx.createBuffer(1, pcm.samples.length, got.rate);
      buf.getChannelData(0).set(pcm.samples);
      const c: Chunk = { buf, off, when: 0 };
      off += buf.duration;
      me.chunks.push(c);
      me.at = Math.max(me.at, ctx.currentTime);
      me.last = sound(me, c, me.at);
      me.at += buf.duration;
    }
    if (cur !== me) return;
    me.end = () => {
      if (cur === me) stop();
    };
    if (me.last) me.last.onended = me.end;
    else me.end();
  }

  /** The orb's speaker level while a reply plays, 0 otherwise. */
  function level(): number {
    if (!cur || state.paused) return 0;
    cur.an.getFloatTimeDomainData(frame);
    return loudness(frame);
  }

  return { play, toggle, stop, back, level, get state() { return state; } };
}

export type Voice = ReturnType<typeof createVoice>;
