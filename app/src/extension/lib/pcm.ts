/** Piper's stream as /speak sends it: raw signed 16-bit little-endian mono, cut wherever the network cut it. */

/** One network chunk to samples in -1..1; an odd trailing byte is carried into the next chunk. */
export function pcmSamples(carry: Uint8Array | null, chunk: Uint8Array): { samples: Float32Array; carry: Uint8Array | null } {
  let bytes = chunk;
  if (carry?.length) {
    bytes = new Uint8Array(carry.length + chunk.length);
    bytes.set(carry);
    bytes.set(chunk, carry.length);
  }
  const whole = bytes.length - (bytes.length % 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, whole);
  const samples = new Float32Array(whole / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  return { samples, carry: whole < bytes.length ? bytes.slice(whole) : null };
}

/** Output level 0..1 from a time-domain frame: RMS, scaled so ordinary speech fills the orb. */
export function loudness(frame: Float32Array): number {
  let sum = 0;
  for (const v of frame) sum += v * v;
  return Math.min(1, Math.sqrt(sum / Math.max(1, frame.length)) * 4);
}
