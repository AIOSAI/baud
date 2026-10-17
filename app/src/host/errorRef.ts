/** The refusal's `ref`, appended to the server's sentence so every screen showing a HostError shows it. */

/**
 * A server sentence with its ref appended, or the sentence alone.
 * Only a non-blank string is a ref, so a missing one never prints "(ref undefined)".
 */
export function withRef(message: string, ref: unknown): string {
  if (typeof ref !== "string") return message;
  const held = ref.trim();
  return held ? `${message} (ref ${held})` : message;
}
