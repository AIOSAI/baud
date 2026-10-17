/**
 * The agent card's mail tile: new and opened, always both, so the tiles sum to the rail's badge.
 * The badge counts opened mail as still waiting (FleetWheel.tsx `waiting`).
 */
export function mailFigure(newMail: number, openedMail: number): string {
  return `${newMail} new · ${openedMail} opened`;
}
