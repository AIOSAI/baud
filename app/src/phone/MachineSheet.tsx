/**
 * THE MACHINE'S VITALS - the placeholder round (Patrick, 2026-08-20).
 *
 * The wheel's monitor layer is real, the cards are real, the flick that reaches
 * them is real. The NUMBERS are not, and this screen's whole job is to say so
 * out loud until they are.
 *
 * WHY IT SHOWS NOTHING RATHER THAN SOMETHING. A monitor exists to be trusted
 * from across the room - Patrick's case for it was *"the fans going crazy and
 * the screen is locked and it's all the way across the room"* - and a face that
 * draws a plausible 12% while measuring nothing is worse than a face that draws
 * no number at all. The first teaches you to trust it and then lies once; the
 * second never lies. Same rule as the agent cards' badges: absent until
 * measured, and a measured zero is a different fact from an unmeasured one.
 *
 * WHAT IT WOULD TAKE, written down so the next round does not have to rediscover
 * it: there is no system-info crate in `src-tauri/Cargo.toml` today. Live vitals
 * need `sysinfo` added there, a snapshot subcommand on the release binary beside
 * `--snapshot` and `--roster`, and an @api lane serving it to this face the way
 * the fleet census already arrives. That is a build with a Rust half and a
 * server half, which is exactly why this round stopped here.
 */

/** What each card promises once it is wired - shown so the placeholder still
 *  says what the thing IS, not merely that it is missing. */
const PROMISE: Record<string, { title: string; blurb: string }> = {
  "mon-cpu": {
    title: "cpu",
    blurb: "load per core, and what is eating it",
  },
  "mon-mem": {
    title: "memory",
    blurb: "used against total, plus swap pressure",
  },
  "mon-temp": {
    title: "temperature",
    blurb: "package and per-sensor - the one that explains the fans",
  },
  "mon-net": {
    title: "network",
    blurb: "throughput up and down, and which interface is carrying it",
  },
  "mon-proc": {
    title: "processes",
    blurb: "what is running, sorted by what it costs",
  },
};

export default function MachineSheet({ card, onClose }: { card: string; onClose: () => void }) {
  // An unknown key is not a crash and not a blank: the wheel could gain a card
  // before this map does, and the honest answer to "what is this" is the key
  // itself rather than an empty screen.
  const promise = PROMISE[card];

  return (
    <section className="baud-phone-reader">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ back
        </button>
        <span className="baud-phone-reader-title">monitor · {promise?.title ?? card}</span>
      </header>

      <p className="baud-phone-empty">
        {promise?.blurb ?? "a reading this face does not have a name for yet"}
      </p>

      {/* THE HONEST LINE. Not an error - nothing failed - so it must not wear
          the error voice; this is a door that exists before the room behind it
          does, and it says which half is missing. */}
      <p className="baud-phone-empty">
        nothing is measured yet — the wheel and the cards are live, the readings
        are not. Wiring them needs the machine lane on the host side.
      </p>
    </section>
  );
}
