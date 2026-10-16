/**
 * THE AGENT CARD'S MAIL TILE, in words that add up to the rail's badge
 * (DPLAN-0414 A#3).
 *
 * The rail's badge counts new AND opened mail (FleetWheel.tsx, `waiting`:
 * opened is still waiting - read, not done). The tile used to show `new_mail`
 * alone, so the four tiles never summed to the badge above them. It now shows
 * both halves, always both: "3 new · 0 opened" says the opened half was
 * counted and is zero, where dropping it would make two different tiles look
 * alike. The badge's other parts (plans, todos, git) are the other tiles.
 */
export function mailFigure(newMail: number, openedMail: number): string {
  return `${newMail} new · ${openedMail} opened`;
}
