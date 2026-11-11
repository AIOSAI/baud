/** Seton's adapter for the side panel, which has no stable hostname: imported before Seton, which reads it once at load. */

declare global {
  interface Window {
    SETON_SITE?: { message: string; composer: string };
  }
}

// The markdown body of an agent reply only: never your own line, a tool row, or a reply's label and buttons.
window.SETON_SITE = { message: ".baud-ext-feed .baud-ext-agent .baud-ext-md", composer: ".baud-ext-ask textarea" };

export {};
