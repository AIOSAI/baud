/** Read-aloud on a reply: the extension's player (panel/voice.ts), one per sheet, so a new play stops the old. Reference: docs/phone/chat.md */

import { useEffect, useState } from "react";

import { createVoice, type Voice, type VoiceState } from "../extension/panel/voice";

/** The sheet's player; it stops when the sheet closes. */
export function useVoice(): { voice: Voice; said: VoiceState } {
  const [said, setSaid] = useState<VoiceState | null>(null);
  const [voice] = useState(() => createVoice(setSaid));
  useEffect(() => () => voice.stop(), [voice]);
  return { voice, said: said ?? voice.state };
}

export function ReadAloud({ id, text, voice, said }: { id: string; text: string; voice: Voice; said: VoiceState }) {
  const mine = said.id === id;
  return (
    <span className="baud-chat-acts">
      <button type="button" aria-label={mine ? (said.paused ? "resume" : "pause") : "read aloud"} onClick={() => void voice.play(id, text)}>
        {mine ? (said.loading ? "…" : said.paused ? "▶" : "⏸") : "▶"}
      </button>
      {mine && (
        <>
          <button type="button" aria-label="back 10 seconds" onClick={() => voice.back(10)}>
            ↺
          </button>
          <button type="button" aria-label="stop reading" onClick={() => voice.stop()}>
            ■
          </button>
        </>
      )}
    </span>
  );
}
