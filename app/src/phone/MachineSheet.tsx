/**
 * THE MACHINE'S VITALS - what a monitor card opens to (FPLAN-0561 row 3).
 *
 * WHAT IS MEASURED NOW. Every number on this screen is @skills'
 * `machine_vitals()`, relayed verbatim by @api on `GET /v1/machine` and read by
 * `lib/machine.ts` while the monitor row is the visible wheel: CPU over the
 * skill's own window and the load averages, memory and swap, the CPU package
 * temperature against its sensor's own high and critical lines, the fan against
 * its range, network throughput, and the process count. The card faces draw
 * from the same read, so a card and its sheet cannot disagree.
 *
 * WHERE THE MEANING LIVES: in the skill, never on this face. Which sensor is the
 * CPU, which rows are nonsense, what an absence is called and the sentence that
 * says so are all the skill's (its README, "machine_vitals() - The Published
 * Read"). This screen prints them. A section the host cannot give keeps the
 * honest line, carrying THAT section's own sentence - never a zero, never an
 * invented scale - and a refusal prints the owner's own words.
 *
 * WHY THE RUST HALF NEVER HAPPENED. The placeholder round planned `sysinfo` in
 * Cargo.toml and a snapshot subcommand beside `--roster`. The probe (DPLAN-0341)
 * found sysinfo has no fan API at all - and the fan is the case Patrick named:
 * *"the fans going crazy and the screen is locked and it's all the way across
 * the room"*. psutil reads it, so the skill that already owned system status
 * publishes the reading, @api proxies it, and this face renders. The desktop
 * binary reads none of it and has no command behind the name.
 */

import type { ReactNode } from "react";

import type { MachineSection, MachineVitals } from "../types";
import { type MachineRead, bytesText, rateText } from "./lib/machine";

/** The sheet's title per card. An unknown key titles itself rather than blanking. */
const TITLES: Record<string, string> = {
  "mon-cpu": "cpu",
  "mon-mem": "memory",
  "mon-temp": "temperature",
  "mon-fan": "fan",
  "mon-net": "network",
  "mon-proc": "processes",
};

export default function MachineSheet({
  card,
  read,
  onClose,
}: {
  card: string;
  read: MachineRead;
  onClose: () => void;
}) {
  return (
    <section className="baud-phone-reader">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ back
        </button>
        <span className="baud-phone-reader-title">monitor · {TITLES[card] ?? card}</span>
      </header>
      <div className="baud-machine">{sheetBody(card, read)}</div>
    </section>
  );
}

function sheetBody(card: string, { reading, refusal }: MachineRead): ReactNode {
  // The owner said no, or the host could not be reached. Every card says the
  // same thing, because it is the same fact: no reading, and whose word that is.
  if (refusal) {
    return (
      <>
        <Headline value="—" />
        <Honest absent>{refusal.message}</Honest>
        <p className="baud-machine-meta">{refusal.code}</p>
      </>
    );
  }
  if (!reading) return <p className="baud-phone-empty">reading the machine…</p>;

  switch (card) {
    case "mon-cpu":
      return <CpuBody reading={reading} />;
    case "mon-mem":
      return <MemoryBody reading={reading} />;
    case "mon-temp":
      return <TempBody reading={reading} />;
    case "mon-fan":
      return <FanBody reading={reading} />;
    case "mon-net":
      return <NetworkBody reading={reading} />;
    case "mon-proc":
      return <ProcessBody reading={reading} />;
    default:
      return <p className="baud-phone-empty">a reading this face does not have a name for yet</p>;
  }
}

/* ------------------------------------------------------------- the cards -- */

function CpuBody({ reading: { cpu, load, sampled_at } }: { reading: MachineVitals }) {
  return (
    <>
      <Headline value={cpu.percent === null ? "—" : fixed(cpu.percent, 1)} unit="%" note="busy" />
      <Section section={cpu} rows={[["percent", percent(cpu.percent)], ["window", seconds(cpu.window_s)]]} />
      <Section
        section={load}
        rows={[
          ["load · 1 min", fixed(load.one, 2)],
          ["load · 5 min", fixed(load.five, 2)],
          ["load · 15 min", fixed(load.fifteen, 2)],
        ]}
      />
      <Sampled at={sampled_at} />
    </>
  );
}

function MemoryBody({ reading: { memory, swap, sampled_at } }: { reading: MachineVitals }) {
  return (
    <>
      <Headline
        value={memory.percent === null ? "—" : fixed(memory.percent, 1)}
        unit="%"
        note={memory.used_bytes === null || memory.total_bytes === null ? undefined : `${bytes(memory.used_bytes)} of ${bytes(memory.total_bytes)}`}
      />
      <Section
        section={memory}
        rows={[
          ["used", bytes(memory.used_bytes)],
          ["total", bytes(memory.total_bytes)],
          ["available", bytes(memory.available_bytes)],
        ]}
      />
      <Section
        section={swap}
        rows={[
          ["swap used", bytes(swap.used_bytes)],
          ["swap total", bytes(swap.total_bytes)],
        ]}
      />
      <Sampled at={sampled_at} />
    </>
  );
}

function TempBody({ reading: { temp, sampled_at } }: { reading: MachineVitals }) {
  return (
    <>
      <Headline value={temp.celsius === null ? "—" : fixed(temp.celsius, 1)} unit="°C" note={temp.label ?? undefined} />
      <Section
        section={temp}
        rows={[
          ["chip", temp.chip ?? "—"],
          ["label", temp.label ?? "—"],
          ["now", celsius(temp.celsius)],
          ["high", celsius(temp.high)],
          ["critical", celsius(temp.critical)],
        ]}
      />
      {temp.seen?.length ? <Rows rows={[["chips seen", temp.seen.join(", ")]]} /> : null}
      <Sampled at={sampled_at} />
    </>
  );
}

function FanBody({ reading: { fan, sampled_at } }: { reading: MachineVitals }) {
  // A real rpm with no range headlines as the rpm - the face draws no ring for
  // it, and the section's sentence below says why.
  const ranged = fan.percent_of_range !== null;
  return (
    <>
      {ranged ? (
        <Headline value={fixed(fan.percent_of_range, 0)} unit="%" note="of its range" />
      ) : (
        <Headline value={fan.current === null ? "—" : String(fan.current)} unit="rpm" note={fan.label ?? undefined} />
      )}
      <Section
        section={fan}
        rows={[
          ["label", fan.label ?? "—"],
          ["current", rpm(fan.current)],
          ["range", fan.range ? `${fan.range.min} – ${fan.range.max} rpm` : "—"],
          ["of range", percent(fan.percent_of_range)],
        ]}
      />
      {(fan.fans ?? []).map((row, index) => (
        <div key={`${row.chip}-${row.label}-${index}`}>
          <Rows
            rows={[
              [
                [row.chip, row.label].filter(Boolean).join(" · ") || `fan ${index + 1}`,
                [rpm(row.current), row.range ? `${row.range.min} – ${row.range.max}` : null, percent(row.percent_of_range)]
                  .filter(Boolean)
                  .join(" · "),
              ],
            ]}
          />
          {row.sentence ? <Honest absent>{row.sentence}</Honest> : null}
        </div>
      ))}
      {fan.seen?.length ? <Rows rows={[["chips seen", fan.seen.join(", ")]]} /> : null}
      <Sampled at={sampled_at} />
    </>
  );
}

function NetworkBody({ reading: { network, sampled_at } }: { reading: MachineVitals }) {
  const both = network.sent_bytes_per_s !== null && network.recv_bytes_per_s !== null;
  return (
    <>
      <Headline value={both ? rateText(network.sent_bytes_per_s! + network.recv_bytes_per_s!) : "—"} note="in and out" />
      <Section
        section={network}
        rows={[
          ["received", rate(network.recv_bytes_per_s)],
          ["sent", rate(network.sent_bytes_per_s)],
          ["window", seconds(network.window_s)],
        ]}
      />
      <Sampled at={sampled_at} />
    </>
  );
}

function ProcessBody({ reading: { processes, sampled_at } }: { reading: MachineVitals }) {
  return (
    <>
      <Headline value={processes.count === null ? "—" : String(processes.count)} note="running" />
      <Section section={processes} rows={[["count", processes.count === null ? "—" : String(processes.count)]]} />
      {/* NOT an absence - the count above is real. The LIST is a later row with
          its own route and cache (names and counts only, never arguments), so
          this line says what is not wired rather than leaving it to be guessed. */}
      <Honest>what is running, by what it costs, is a deferred row with its own route — not wired yet.</Honest>
      <Sampled at={sampled_at} />
    </>
  );
}

/* ------------------------------------------------------------ the pieces -- */

function Headline({ value, unit, note }: { value: string; unit?: string; note?: string }) {
  return (
    <div className="baud-machine-headline">
      <span className={`baud-machine-value ${value === "—" ? "baud-machine-value-absent" : ""}`}>
        {value}
        {unit && value !== "—" ? <small>{unit}</small> : null}
      </span>
      {note ? <span className="baud-machine-note">{note}</span> : null}
    </div>
  );
}

function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="baud-machine-rows">
      {rows.map(([label, value], index) => (
        <div key={`${label}-${index}`}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One section: its rows when the host gave it, and the skill's sentence when
 * there is one - which is ALWAYS when it is absent, and sometimes beside a
 * reading that is real but partial (a fan with an rpm and no range).
 */
function Section({ section, rows }: { section: MachineSection; rows: Array<[string, string]> }) {
  return (
    <>
      {section.available ? <Rows rows={rows} /> : null}
      {!section.available || section.sentence ? (
        <Honest absent>
          {section.sentence ?? `unavailable (${section.reason ?? "no reason given"})`}
          {section.detail ? <span className="baud-machine-detail">{section.detail}</span> : null}
        </Honest>
      ) : null}
    </>
  );
}

/** THE HONEST LINE. Not the error voice - an absent sensor is a fact about this
 *  machine, not a failure of the face - so it is quiet, with an amber rule when
 *  it is saying something is missing. */
function Honest({ absent = false, children }: { absent?: boolean; children: ReactNode }) {
  return <p className={`baud-machine-honest ${absent ? "baud-machine-honest-absent" : ""}`}>{children}</p>;
}

function Sampled({ at }: { at: string }) {
  const when = new Date(at);
  return (
    <p className="baud-machine-meta">
      sampled {Number.isNaN(when.getTime()) ? at : when.toLocaleTimeString()} · @skills via @api
    </p>
  );
}

/* A null prints as a dash everywhere below - never as 0. */
const fixed = (value: number | null, digits: number) => (value === null ? "—" : value.toFixed(digits));
const percent = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)} %`);
const seconds = (value: number | null) => (value === null ? "—" : `${value.toFixed(2)} s`);
const celsius = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)} °C`);
const rpm = (value: number | null) => (value === null ? "—" : `${Math.round(value)} rpm`);
const rate = (value: number | null) => (value === null ? "—" : rateText(value));
const bytes = (value: number | null) => (value === null ? "—" : bytesText(value));
