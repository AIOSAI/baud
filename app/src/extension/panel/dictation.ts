/** Hold Space to talk, the deck's rule: Chrome's speech recognition writes at the cursor while Space is held; it never
    sends. In the box a tap types a space and a hold (the key's auto-repeat) takes that space back and listens; outside
    any field a hold listens too; in another field Space is left alone. */

interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export interface DictationSay {
  listening: boolean;
  /** Replaces the box's hint: "listening…" or Chrome's error; null gives the hint back, absent keeps it. */
  hint?: string | null;
}

export function holdSpace(box: () => HTMLTextAreaElement | null, say: (s: DictationSay) => void): () => void {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Found = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Found) return () => undefined;
  const Speech = Found;
  let rec: Recognition | null = null;
  let pressAt: number | null = null;
  let held = false;
  let failed = false;

  function listen(input: HTMLTextAreaElement, at: number) {
    // Chrome ends a session on a pause; while Space is still held a fresh one picks up at the cursor
    const head = input.value.slice(0, at);
    const tail = input.value.slice(at);
    const before = head + (head && !/\s$/.test(head) ? " " : "");
    const r = new Speech();
    rec = r;
    r.continuous = r.interimResults = true;
    r.lang = navigator.language || "en-US";
    r.onresult = (ev) => {
      const said = Array.from(ev.results, (x) => x[0].transcript).join("").trim();
      input.value = before + said + tail;
      input.setSelectionRange((before + said).length, (before + said).length);
      if (!tail) input.scrollTop = input.scrollHeight;
    };
    r.onerror = (ev) => {
      failed = true;
      say({ listening: held, hint: `speech: ${ev.error}` });
      held = held && ev.error === "no-speech";
    };
    r.onend = () => {
      if (held) return listen(input, input.selectionStart);
      rec = null;
      say(failed ? { listening: false } : { listening: false, hint: null });
      input.focus();
    };
    r.start();
  }

  const down = (e: KeyboardEvent) => {
    if (e.code !== "Space") return;
    const input = box();
    const el = document.activeElement;
    if (!input || (el !== input && el instanceof Element && el.matches("input, textarea, select"))) return;
    if (held) return e.preventDefault();
    if (el === input && !e.repeat) {
      pressAt = input.selectionStart; // a tap: the space types as usual
      return;
    }
    e.preventDefault();
    let at = input.value.length;
    if (el === input && pressAt !== null) {
      at = pressAt;
      input.value = input.value.slice(0, at) + input.value.slice(at + 1);
    }
    held = true;
    failed = false;
    input.focus();
    say({ listening: true, hint: "listening… let go of space to stop" });
    listen(input, at);
  };
  const up = (e: KeyboardEvent) => {
    if (e.code !== "Space") return;
    pressAt = null;
    if (!held) return;
    e.preventDefault();
    held = false;
    rec?.stop();
  };
  addEventListener("keydown", down);
  addEventListener("keyup", up);
  return () => {
    removeEventListener("keydown", down);
    removeEventListener("keyup", up);
    rec?.stop();
  };
}
