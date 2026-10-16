/**
 * THE MACHINE'S VITALS - what a monitor card opens to (FPLAN-0561 row 3).
 *
 * WHAT IS MEASURED NOW. Every number on this screen is @skills'
 * `machine_vitals()`, relayed verbatim by @api on `GET /v1/machine` and read by
 * `lib/machine.ts` while the monitor row is the visible wheel: CPU over the
 * skill's own window and the load averages, memory and swap, the CPU package
 * temperature against its sensor's own high and critical lines, the fan against
 * its range, network throughput, and the process count. The card faces draw
 * from the same read, so a card and its sheet cannot disagree. The ONE read
 * that is not the vitals is the PROC sheet's top-20 list (DPLAN-0414 T3),
 * `GET /v1/machine/processes`, read once per open and on a tap - see
 * `useProcessList` below.
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

import { type ReactNode, useEffect, useState } from "react";

import { machineProcesses } from "../host";
import { HostError } from "../host/transport.http";
import type { MachineProcesses, MachineSection, MachineVitals } from "../types";
import { PREDATES_BATTERY, timeLeftText } from "./lib/battery";
import { type MachineRead, bytesText, rateText } from "./lib/machine";
import {
  PROCESS_LIMIT,
  type ProcessSort,
  memText,
  pctText,
  processName,
  sampledLine,
  sortProcesses,
} from "./lib/processes";

/** The sheet's title per card. An unknown key titles itself rather than blanking. */
const TITLES: Record<string, string> = {
  "mon-cpu": "cpu",
  "mon-mem": "memory",
  "mon-temp": "temperature",
  "mon-fan": "fan",
  "mon-net": "network",
  "mon-proc": "processes",
  "mon-bat": "battery",
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
  // Read ONCE when the PROC sheet opens, and on a tap - never on the vitals'
  // cadence and never while the sheet is shut, because this component is only
  // mounted while it is open (DPLAN-0414 T3).
  const procs = useProcessList(card === "mon-proc");
  return (
    <section className="baud-phone-reader">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ back
        </button>
        <span className="baud-phone-reader-title">monitor · {TITLES[card] ?? card}</span>
      </header>
      <div className="baud-machine">{sheetBody(card, read, procs)}</div>
    </section>
  );
}

function sheetBody(card: string, { reading, refusal }: MachineRead, procs: ProcessList): ReactNode {
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
      return <ProcessBody reading={reading} procs={procs} />;
    case "mon-bat":
      return <BatteryBody reading={reading} />;
    default:
      return <p className="baud-phone-empty">a reading this face does not have a name for yet</p>;
  }
}

/* ------------------------------------------------------------- the cards -- */

/**
 * THE CORES (FPLAN-0586 row 2). Patrick, 2026-09-13: *"when i open it id expect
 * to see the cores, not really sure what all this even is"*. So the page is the
 * headline, one bar per CPU, what the machine has, and the load averages with a
 * caption - every row says what it is in words. The percent row (the headline
 * again) is cut, and the sample window rides the sampled line.
 */
function CpuBody({ reading: { cpu, load, sampled_at } }: { reading: MachineVitals }) {
  return (
    <>
      <Headline value={cpu.percent === null ? "—" : fixed(cpu.percent, 1)} unit="%" note="busy" />
      {/* One bar per entry the skill LISTS - the online CPUs - never one per
          configured count, which can differ. Null while warming, and then the
          section's own sentence stands in: never zero-height bars. */}
      {cpu.cores ? <CoreBars cores={cpu.cores} /> : null}
      <Section section={cpu} rows={[]} />
      <p className="baud-machine-counts">
        {countsLine(cpu)}
        {/* No cpu_freq leaves the section available with the reason in
            `detail` - said here, under the dashes it explains, unless the
            section's own sentence above already carries it. */}
        {cpu.available && !cpu.sentence && cpu.detail ? <span className="baud-machine-detail">{cpu.detail}</span> : null}
      </p>
      <Section
        section={load}
        rows={[
          ["load · 1 min", fixed(load.one, 2)],
          ["load · 5 min", fixed(load.five, 2)],
          ["load · 15 min", fixed(load.fifteen, 2)],
        ]}
      />
      {load.available ? (
        <p className="baud-machine-caption">
          tasks wanting a CPU, averaged over 1, 5 and 15 minutes; equal to the thread count
          {cpu.logical === null ? "" : ` (${cpu.logical})`} means every thread busy, above it means queueing.
        </p>
      ) : null}
      <Sampled at={sampled_at} over={cpu.window_s} />
    </>
  );
}

/** A bar per core. The fill is an SVG width, not a style attribute - the face's
 *  no-inline-styles discipline, the same way the wheel's ring holds it. */
function CoreBars({ cores }: { cores: number[] }) {
  return (
    <div className="baud-machine-bars">
      {cores.map((busy, index) => (
        <div key={index} className="baud-machine-bar">
          <span className="baud-machine-bar-label">core {index}</span>
          <svg className="baud-machine-bar-track" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
            <rect className="baud-machine-bar-fill" x="0" y="0" width={Math.max(0, Math.min(100, busy))} height="6" />
          </svg>
          <span className="baud-machine-bar-value">{fixed(busy, 1)}%</span>
        </div>
      ))}
    </div>
  );
}

/** "4 threads on 2 cores · 1.1 GHz, up to 3.3". Every piece is a dash when its
 *  value is null, never 0; equal counts say the cores once. */
function countsLine(cpu: MachineVitals["cpu"]): string {
  const counted = (n: number | null, one: string) => `${n ?? "—"} ${one}${n === 1 ? "" : "s"}`;
  const counts =
    cpu.logical !== null && cpu.logical === cpu.physical
      ? counted(cpu.physical, "core")
      : `${counted(cpu.logical, "thread")} on ${counted(cpu.physical, "core")}`;
  const ghz = (mhz: number | null) => (mhz === null ? "—" : (mhz / 1000).toFixed(1));
  return `${counts} · ${ghz(cpu.mhz)} GHz, up to ${ghz(cpu.mhz_max)}`;
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

/* ---------------------------------------------------- the process list -- */

/** One visit's process read: the latest list, the latest refusal, and whether
 *  a sample is in flight. `again` is the tap on the sampled line. */
interface ProcessList {
  read: MachineProcesses | null;
  refusal: { code: string; message: string } | null;
  sampling: boolean;
  again: () => void;
}

/**
 * THE TOP-20 READ (DPLAN-0414 T3, contract C-B). NOT POLLED, and that is the
 * ruling, not an economy: the owner's case is "laptop fan going crazy ... what
 * is running", a glance, and the skill sleeps about half a second per sample
 * to measure cpu honestly. So one read when the PROC sheet opens, one per tap
 * on the sampled line, and nothing on the monitor row's two-second cadence.
 * The sheet unmounts when it shuts, and this goes with it.
 *
 * A refusal is held exactly as the vitals lane holds one (`lib/machine.ts`):
 * the HostError's code and the server's own sentence, verbatim.
 */
function useProcessList(active: boolean): ProcessList {
  const [read, setRead] = useState<MachineProcesses | null>(null);
  const [refusal, setRefusal] = useState<ProcessList["refusal"]>(null);
  // Born sampling when the sheet is the PROC one: the read goes out in the
  // effect, after the first paint, and that paint must already say so.
  const [sampling, setSampling] = useState(active);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    if (!active) return;
    let live = true;
    setSampling(true);
    machineProcesses(PROCESS_LIMIT)
      .then(
        (answer) => {
          if (!live) return;
          setRead(answer);
          setRefusal(null);
        },
        (cause: unknown) => {
          if (!live) return;
          setRefusal({
            code: cause instanceof HostError ? cause.code : "error",
            message: cause instanceof Error ? cause.message : String(cause),
          });
        },
      )
      .finally(() => {
        if (live) setSampling(false);
      });
    return () => {
      live = false;
    };
  }, [active, asked]);

  return { read, refusal, sampling, again: () => setAsked((n) => n + 1) };
}

/**
 * THE PROC CARD'S SHEET (DPLAN-0414 B#1). The headline is EVERY pid the host
 * counted, sleeping ones included - so it says "processes", never "running"
 * (the host sends no running count). Below it, the twenty busiest by cpu as the
 * host sampled them, and a toggle that re-orders the same twenty by memory on
 * the phone. The line under the list says when the sample was taken and reads
 * again on a tap; while a sample is in flight it says "sampling…".
 */
function ProcessBody({ reading: { processes }, procs }: { reading: MachineVitals; procs: ProcessList }) {
  const [by, setBy] = useState<ProcessSort>("cpu");
  const rows = procs.read ? sortProcesses(procs.read.processes, by) : [];
  return (
    <>
      <Headline value={processes.count === null ? "—" : String(processes.count)} note="processes" />
      <Section section={processes} rows={[["count", processes.count === null ? "—" : String(processes.count)]]} />
      {procs.refusal ? (
        // The same sentence the vitals refusal shows: the owner's own words.
        <Honest absent>{procs.refusal.message}</Honest>
      ) : rows.length > 0 ? (
        <>
          <div className="baud-machine-sort" role="group" aria-label="order the list by">
            {(["cpu", "mem"] as const).map((key) => (
              <button
                key={key}
                type="button"
                className={`baud-machine-sort-chip ${by === key ? "baud-machine-sort-chip-on" : ""}`}
                aria-pressed={by === key}
                onClick={() => setBy(key)}
              >
                {key}
              </button>
            ))}
          </div>
          <ol className="baud-machine-procs">
            <li className="baud-machine-proc baud-machine-proc-head" aria-hidden="true">
              <span>name</span>
              <span>cpu</span>
              <span>mem</span>
              <span>MB</span>
            </li>
            {rows.map((row) => (
              <li key={row.pid} className="baud-machine-proc">
                <span className="baud-machine-proc-name">{processName(row)}</span>
                <span>{pctText(row.cpu_pct)}</span>
                <span>{pctText(row.mem_pct)}</span>
                <span>{memText(row.mem_mb)}</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      <button
        type="button"
        className="baud-machine-meta baud-machine-sampled"
        disabled={procs.sampling}
        onClick={procs.again}
      >
        {sampledLine(procs.read, procs.sampling, clockTime)}
      </button>
    </>
  );
}

/**
 * THE BATTERY (2026-10-12). Charge, what the power is doing, and time left, with
 * the host's own low and critical lines when it publishes them. An older skill
 * sends no battery key at all, and that is said rather than drawn as an empty
 * machine.
 */
function BatteryBody({ reading: { battery, sampled_at } }: { reading: MachineVitals }) {
  if (!battery) {
    return (
      <>
        <Headline value="—" />
        <Honest absent>{PREDATES_BATTERY}</Honest>
        <Sampled at={sampled_at} />
      </>
    );
  }
  return (
    <>
      <Headline
        value={battery.percent === null ? "—" : fixed(battery.percent, 0)}
        unit="%"
        note={battery.state === "unknown" ? undefined : battery.state}
      />
      <Section
        section={battery}
        rows={[
          ["state", battery.state],
          ["plugged in", battery.plugged === null ? "—" : battery.plugged ? "yes" : "no"],
          ["time left", timeLeftText(battery.seconds_left, battery.plugged)],
          ...(battery.low === null ? [] : [["low line", percent(battery.low)] as [string, string]]),
          ...(battery.critical === null ? [] : [["critical line", percent(battery.critical)] as [string, string]]),
        ]}
      />
      {battery.available && battery.low === null && battery.critical === null ? (
        <Honest>the host publishes no low or critical line, so the ring never changes colour.</Honest>
      ) : null}
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
      {section.available && rows.length > 0 ? <Rows rows={rows} /> : null}
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

/** A sample's time of day, or the host's own string when it does not parse. */
function clockTime(at: string): string {
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? at : when.toLocaleTimeString();
}

function Sampled({ at, over = null }: { at: string; over?: number | null }) {
  return (
    <p className="baud-machine-meta">
      sampled {clockTime(at)}
      {over === null ? "" : ` over ${over.toFixed(1)} s`} · @skills via @api
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
