/**
 * The machine's vitals - what a monitor card opens to. Reference: docs/phone/monitor.md
 * Every number and every absence sentence is @skills' `machine_vitals()`, printed as sent.
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
  // Read once on open and on a tap, never on the vitals' cadence; mounted only while open.
  const procs = useProcessList(card === "mon-proc");
  return (
    <section className="baud-phone-reader">
      <header className="baud-phone-reader-head">
        <button type="button" className="baud-phone-back" onClick={onClose}>
          ‹ wheel
        </button>
        <span className="baud-phone-reader-title">monitor · {TITLES[card] ?? card}</span>
      </header>
      <div className="baud-machine">{sheetBody(card, read, procs)}</div>
    </section>
  );
}

function sheetBody(card: string, { reading, refusal }: MachineRead, procs: ProcessList): ReactNode {
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


/** The cores: the headline, one bar per CPU, the counts, and the load averages with a caption. */
function CpuBody({ reading: { cpu, load, sampled_at } }: { reading: MachineVitals }) {
  return (
    <>
      <Headline value={cpu.percent === null ? "—" : fixed(cpu.percent, 1)} unit="%" note="busy" />
      {/* One bar per CPU the skill lists (online), never per configured count; null while
          warming, when the section's sentence stands in. */}
      {cpu.cores ? <CoreBars cores={cpu.cores} /> : null}
      <Section section={cpu} rows={[]} />
      <p className="baud-machine-counts">
        {countsLine(cpu)}
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

/** A bar per core; the fill is an SVG width, keeping the face free of inline styles. */
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

/** "4 threads on 2 cores · 1.1 GHz, up to 3.3"; a null piece is a dash, never 0. */
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


/** One visit's process read; `again` is the tap on the sampled line. */
interface ProcessList {
  read: MachineProcesses | null;
  refusal: { code: string; message: string } | null;
  sampling: boolean;
  again: () => void;
}

/**
 * The top-20 read. Not polled, by ruling: the skill sleeps about half a second per
 * sample, so one read per open and one per tap, never on the row's cadence.
 */
function useProcessList(active: boolean): ProcessList {
  const [read, setRead] = useState<MachineProcesses | null>(null);
  const [refusal, setRefusal] = useState<ProcessList["refusal"]>(null);
  // Born sampling: the read goes out after the first paint, and that paint must say so.
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

/** The PROC sheet: the headline counts every pid, sleeping too, so it says "processes", never "running". */
function ProcessBody({ reading: { processes }, procs }: { reading: MachineVitals; procs: ProcessList }) {
  const [by, setBy] = useState<ProcessSort>("cpu");
  const rows = procs.read ? sortProcesses(procs.read.processes, by) : [];
  return (
    <>
      <Headline value={processes.count === null ? "—" : String(processes.count)} note="processes" />
      <Section section={processes} rows={[["count", processes.count === null ? "—" : String(processes.count)]]} />
      {procs.refusal ? (
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

/** The battery: charge, power state and time left; an older skill sends no battery key at all. */
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

/** One section: its rows, and the skill's sentence whenever it is absent or partial. */
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

/** The honest line: an absent sensor is a fact about the machine, so it is quiet, not the error voice. */
function Honest({ absent = false, children }: { absent?: boolean; children: ReactNode }) {
  return <p className={`baud-machine-honest ${absent ? "baud-machine-honest-absent" : ""}`}>{children}</p>;
}

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
