/**
 * The ref a refusal carries, on the end of the sentence the phone shows
 * (DPLAN-0414 C#1).
 *
 * WHY THE SENTENCE IS NOT ENOUGH ANY MORE. @api stopped copying a caught
 * exception's words into a response (CodeQL py/stack-trace-exposure): the words
 * go to the host's log, the client gets one fixed sentence per error code, and
 * a short `ref` sits beside it in the envelope - their docstring says "the
 * handset shows it, the operator greps for it". The phone read `code` and
 * `message` and dropped `ref`, so every refused read on the face said "the
 * reason is in this host's log" and gave the operator nothing to find it by.
 *
 * ONE SHORT FORM, ON THE END. `… (ref a1b2c3d4e5f6)`: the server's sentence
 * stays first and unreworded, and the ref reads as a footnote to it. Every
 * screen that shows a HostError's message gets it for free, because the ref is
 * part of the message rather than a field each screen would have to learn.
 */

/**
 * A server sentence with its ref appended, or the sentence alone.
 *
 * Args:
 *   message: The envelope's `message`, verbatim.
 *   ref: The envelope's `ref`, whatever arrived - only a non-blank string is a
 *     ref; anything else (absent, null, a number from a server that changed its
 *     mind) adds nothing rather than printing "(ref undefined)".
 *
 * Returns:
 *   `"<message> (ref <ref>)"`, or `message` untouched.
 */
export function withRef(message: string, ref: unknown): string {
  if (typeof ref !== "string") return message;
  const held = ref.trim();
  return held ? `${message} (ref ${held})` : message;
}
