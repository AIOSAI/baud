/** The phone's fleet screen: a stacked wheel of agent and app cards. Reference: docs/phone/wheel.md */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { BranchStatus } from "../types";

const SCALE_CENTER = 1.28;
const SCALE_SPREAD = 0.38;
const FADE = 0.55;

/** `has_room` is not consulted: a room existing does not mean anyone is in it. */
export const isAwake = (branch: BranchStatus): boolean =>
  branch.dispatched || branch.interactive;

/** One layer of the stack. The gesture, pips and flash read their bounds off WHEELS, so a new layer is one row. */
interface WheelLayerBase {
  key: string;
  name: string;
  empty: string;
}

interface AgentLayer extends WheelLayerBase {
  holds: "agents";
  /** "system" is a separate lane that can be absent while the seated "project" read is healthy. */
  source: "project" | "system";
  hold: (branch: BranchStatus) => boolean;
}

interface AppLayer extends WheelLayerBase {
  holds: "apps";
  cards: ReadonlyArray<AppCard>;
}

/** A door opens a surface inside this face; a link leaves for the browser and wears a corner arrow. */
interface AppCard {
  key: string;
  mark: string;
  name: string;
  kind: "door" | "link";
}

export interface AppFace {
  value: string;
  unit?: string;
  absent: boolean;
  /** `none`: no range, no ring. `dead`: absent reading, dimmed track. Otherwise percent of the card's own range. */
  ring: "none" | "dead" | { percent: number; tone: "normal" | "warm" | "hot" };
}

/** Outline inside the card's 2px border (the centred card's scale spends the headroom); pathLength 100 makes a percent a dash length. */
const RING_PATH = "M20 1H31A8 8 0 0 1 39 9V31A8 8 0 0 1 31 39H9A8 8 0 0 1 1 31V9A8 8 0 0 1 9 1Z";

function AppRing({ ring }: { ring: AppFace["ring"] }) {
  if (ring === "none") return null;
  const tone = ring === "dead" ? "dead" : ring.tone;
  return (
    <svg className={`baud-wheel-ring baud-wheel-ring-${tone}`} viewBox="0 0 40 40" aria-hidden="true">
      <path className="baud-wheel-ring-track" d={RING_PATH} pathLength={100} />
      {ring === "dead" ? null : (
        <path
          className="baud-wheel-ring-value"
          d={RING_PATH}
          pathLength={100}
          strokeDasharray={`${ring.percent} 100`}
        />
      )}
    </svg>
  );
}

type WheelLayer = AgentLayer | AppLayer;

/** Live and dispatched partition the working set by the desktop lamp's precedence, so a wheel's name and a card's light agree. */
const WHEELS: ReadonlyArray<WheelLayer> = [
  {
    key: "project",
    name: "current project",
    empty: "this project has no agents",
    holds: "agents",
    source: "project",
    hold: () => true,
  },
  {
    key: "live",
    name: "live",
    // Not "no agents": the fleet is full, the working set is empty, and those are different facts.
    empty: "no one live",
    holds: "agents",
    source: "system",
    hold: (branch) => branch.interactive && !branch.dispatched,
  },
  {
    key: "dispatched",
    name: "dispatched",
    empty: "nothing dispatched",
    holds: "agents",
    source: "system",
    hold: (branch) => branch.dispatched,
  },
  {
    key: "apps",
    name: "apps",
    empty: "no apps on this face yet",
    holds: "apps",
    cards: [
      {
        key: "git",
        mark: "GIT",
        name: "git",
        kind: "door",
      },
      {
        key: "files",
        mark: "FILES",
        name: "files",
        kind: "door",
      },
      // BKP, not BACKUP: FILES is the widest mark the 44px square holds.
      {
        key: "backup",
        mark: "BKP",
        name: "backup",
        kind: "door",
      },
    ],
  },
  /** Last, so the looping stack puts the monitor one backward flick from the first layer; the sheet keys on these card keys. */
  {
    key: "monitor",
    name: "monitor",
    empty: "nothing to measure on this face yet",
    holds: "apps",
    cards: [
      { key: "mon-cpu", mark: "CPU", name: "cpu", kind: "door" },
      { key: "mon-mem", mark: "MEM", name: "memory", kind: "door" },
      { key: "mon-temp", mark: "TEMP", name: "temp", kind: "door" },
      { key: "mon-fan", mark: "FAN", name: "fan", kind: "door" },
      { key: "mon-net", mark: "NET", name: "network", kind: "door" },
      { key: "mon-proc", mark: "PROC", name: "processes", kind: "door" },
      { key: "mon-bat", mark: "BAT", name: "battery", kind: "door" },
    ],
  },
];

const SWITCH_PX = 30;

const FLASH_MS = 1100;

export const cardRef = (branch: BranchStatus): string => `${branch.project}/${branch.name}`;

/** The seated project's manager (by the `manager` field, never by name), else the first card. */
export const openingCard = (
  cards: readonly BranchStatus[],
  seatedProject: string,
): BranchStatus | undefined =>
  cards.find((card) => card.manager && card.project === seatedProject) ?? cards[0];

interface FleetWheelProps {
  branches: BranchStatus[];
  /** Null when the lane is unavailable: null is "could not look", empty is "nobody is working". */
  roster: BranchStatus[] | null;
  rosterRefusal: { line: string; detail: string } | null;
  seatedProject: string;
  /** Absent until the slow git sweep reaches a branch: a zero would claim a clean working tree. */
  gitCounts: Readonly<Record<string, number | undefined>>;
  centered: string | null;
  attached: string | null;
  appBadges: Readonly<Record<string, number | undefined>>;
  appFaces: Readonly<Record<string, AppFace | undefined>>;
  /** The shell reads the machine only while this reports the monitor row. */
  onLayer: (key: string) => void;
  onCenter: (name: string) => void;
  onExpand: (name: string) => void;
  onOpenApp: (key: string) => void;
}

export default function FleetWheel({
  branches,
  roster,
  rosterRefusal,
  seatedProject,
  gitCounts,
  centered,
  attached,
  appBadges,
  appFaces,
  onLayer,
  onCenter,
  onExpand,
  onOpenApp,
}: FleetWheelProps) {
  const rail = useRef<HTMLDivElement | null>(null);
  /** The drag surface, and the element that must out-argue the browser's pull-to-refresh. */
  const wrap = useRef<HTMLDivElement | null>(null);
  const reported = useRef<string | null>(null);
  const appReported = useRef<string | null>(null);
  const [appCentered, setAppCentered] = useState<string | null>(null);

  const [layer, setLayer] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  /** Where each wheel was left, by key; a ref because restoring a scroll offset must not be a render. */
  const memory = useRef<Record<string, number>>({});
  const drag = useRef<{ x: number; y: number } | null>(null);
  /** This gesture already switched a wheel, so its closing click must not select or launch a card. */
  const swiped = useRef(false);

  const wheel = WHEELS[layer];
  const citizens = wheel.holds === "agents" ? wheel : null;
  const apps = wheel.holds === "apps" ? wheel.cards : null;
  const census = citizens ? (citizens.source === "system" ? roster : branches) : [];
  const shown = useMemo(
    () => (citizens ? (census ?? []).filter(citizens.hold) : []),
    [census, citizens],
  );
  /** A null roster with no refusal yet is only the cold load before the first answer. */
  const blocked =
    census === null ? (rosterRefusal ?? { line: "reading…", detail: "" }) : null;
  /** Cards held, of either kind: the empty line, the ghost card and the paint effect key on it. */
  const held = apps ? apps.length : shown.length;

  const layerKey = wheel.key;
  useEffect(() => onLayer(layerKey), [onLayer, layerKey]);

  /** Imperative on purpose: it runs every frame of a flick, and state goes up only when the centred card changes. */
  const paint = useCallback(() => {
    const strip = rail.current;
    if (!strip) return;
    const middle = strip.getBoundingClientRect().left + strip.clientWidth / 2;
    const reach = strip.clientWidth / 2 || 1;

    let nearest: HTMLElement | null = null;
    let nearestGap = Number.POSITIVE_INFINITY;

    for (const node of Array.from(strip.children)) {
      const card = node as HTMLElement;
      const box = card.getBoundingClientRect();
      const gap = Math.abs(box.left + box.width / 2 - middle);
      const away = Math.min(gap / reach, 1);
      card.style.transform = `scale(${SCALE_CENTER - SCALE_SPREAD * away})`;
      card.style.opacity = String(1 - FADE * away);
      if (gap < nearestGap) {
        nearestGap = gap;
        nearest = card;
      }
    }

    const name = nearest?.dataset.name ?? null;
    if (name && name !== reported.current) {
      reported.current = name;
      onCenter(name);
    }

    // An app is not an agent: the centre report carries project/branch refs, so the apps layer keeps its centre local.
    const app = nearest?.dataset.app ?? null;
    if (app !== appReported.current) {
      appReported.current = app;
      setAppCentered(app);
    }
  }, [onCenter]);

  useEffect(() => {
    const strip = rail.current;
    if (!strip) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        paint();
      });
    };
    strip.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(() => paint());
    observer.observe(strip);
    paint();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      strip.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
    // The visible count, not the fleet's: an agent going idle leaves the active wheel without changing branches.length.
  }, [paint, held]);

  /** A layout effect so the remembered offset is restored before the browser paints, not as a visible jump. */
  useLayoutEffect(() => {
    const strip = rail.current;
    if (!strip) return;
    strip.scrollLeft = memory.current[WHEELS[layer].key] ?? 0;
    paint();
  }, [layer, paint]);

  /** The project wheel is placed per seat, since a project switch replaces its cards; other wheels are placed per wheel. */
  const placeKey = `${wheel.key}:${citizens?.source === "project" ? seatedProject : ""}`;
  const placed = useRef<Record<string, boolean>>({});

  /** Opening placement, once per key and only after cards exist, so a hand always outranks it; an empty wheel is not spent. */
  useLayoutEffect(() => {
    const strip = rail.current;
    if (!strip || placed.current[placeKey]) return;
    const target = openingCard(shown, seatedProject);
    if (!target) return;
    const ref = cardRef(target);
    const card = Array.from(strip.children).find(
      (node) => (node as HTMLElement).dataset.name === ref,
    ) as HTMLElement | undefined;
    if (!card) return;
    placed.current[placeKey] = true;
    // paint()'s own measurement, so the settled card is the one paint centres; scrollIntoView may scroll ancestors.
    const box = card.getBoundingClientRect();
    const middle = strip.getBoundingClientRect().left + strip.clientWidth / 2;
    strip.scrollLeft += box.left + box.width / 2 - middle;
    paint();
  }, [placeKey, seatedProject, shown, paint]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const switchTo = useCallback(
    (next: number) => {
      if (next === layer || next < 0 || next >= WHEELS.length) return;
      const strip = rail.current;
      if (strip) memory.current[WHEELS[layer].key] = strip.scrollLeft;
      // Clearing the mirror makes paint() re-report on arrival, or the face keeps following a hidden agent.
      reported.current = null;
      setLayer(next);
      setFlash(WHEELS[next].name);
    },
    [layer],
  );

  /** The stack loops; the modulo is doubled because JS `%` keeps the left operand's sign. */
  const stepBy = useCallback(
    (delta: number) => {
      const count = WHEELS.length;
      switchTo(((layer + delta) % count + count) % count);
    },
    [layer, switchTo],
  );

  /** Native non-passive touchmove that claims a vertical drag before pull-to-refresh, which decides on its first touchmove.
   * React's delegated touch listeners are passive, so their preventDefault is ignored. */
  useEffect(() => {
    const box = wrap.current;
    if (!box) return;

    const start = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      drag.current = { x: touch.clientX, y: touch.clientY };
      swiped.current = false;
    };

    const move = (event: TouchEvent) => {
      const from = drag.current;
      const touch = event.touches[0];
      if (!from || !touch) return;
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      if (Math.abs(dy) <= Math.abs(dx)) return;
      if (event.cancelable) event.preventDefault();
      if (Math.abs(dy) < SWITCH_PX) return;
      // One switch per gesture, so a long drag cannot ride through the whole stack.
      drag.current = null;
      swiped.current = true;
      stepBy(dy < 0 ? 1 : -1);
    };

    const end = () => {
      drag.current = null;
    };

    box.addEventListener("touchstart", start, { passive: true });
    box.addEventListener("touchmove", move, { passive: false });
    box.addEventListener("touchend", end, { passive: true });
    box.addEventListener("touchcancel", end, { passive: true });
    return () => {
      box.removeEventListener("touchstart", start);
      box.removeEventListener("touchmove", move);
      box.removeEventListener("touchend", end);
      box.removeEventListener("touchcancel", end);
    };
  }, [stepBy]);

  /** Mouse drag only: touch raises both pointer and touch events, and one gesture must not count twice. */
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    drag.current = { x: event.clientX, y: event.clientY };
    swiped.current = false;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const from = drag.current;
    if (!from) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    if (Math.abs(dy) < SWITCH_PX || Math.abs(dy) <= Math.abs(dx)) return;
    drag.current = null;
    swiped.current = true;
    stepBy(dy < 0 ? 1 : -1);
  };

  const onPointerEnd = () => {
    drag.current = null;
  };

  /** A tap on an off-centre card only centres it; only a tap on the centred card opens it. */
  const onTap = (event: React.MouseEvent<HTMLDivElement>) => {
    // A swipe ends in a click that must not select; swiped clears on pointerdown because the click follows pointerup.
    if (swiped.current) return;
    const card = (event.target as HTMLElement).closest<HTMLElement>(".baud-wheel-card");
    if (!card) return;

    const app = card.dataset.app;
    if (app) {
      if (app !== appCentered) {
        card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        return;
      }
      onOpenApp(app);
      return;
    }

    const name = card.dataset.name;
    if (!name) return;
    if (name !== centered) {
      card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      return;
    }
    onExpand(name);
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the
    // cards and pips inside are buttons; this is the wheel's drag surface.
    <div
      ref={wrap}
      className={`baud-wheel-wrap ${apps ? "baud-wheel-wrap-apps" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the
          cards inside are buttons; this is one delegated listener over them. */}
      <div ref={rail} className="baud-wheel" onClick={onTap}>
        {/* A ghost card holds the rail's height when empty; it has no data-name, so paint() reports nothing. */}
        {held === 0 ? (
          <div className="baud-wheel-card baud-wheel-ghost" aria-hidden="true">
            <span className="baud-wheel-avatar" />
            <span className="baud-wheel-name">—</span>
          </div>
        ) : null}
        {/* `data-app` instead of `data-name` keeps app cards out of the current-agent report. */}
        {(apps ?? []).map((card) => {
          const badge = appBadges[card.key];
          const face = appFaces[card.key];
          return (
            <div
              key={card.key}
              className={`baud-wheel-card ${card.key === appCentered ? "baud-wheel-center" : ""}`}
              data-app={card.key}
            >
              <button
                type="button"
                className={`baud-wheel-avatar baud-wheel-avatar-app ${face ? "baud-wheel-avatar-face" : ""}`}
                title={
                  card.kind === "link"
                    ? `${card.name} — opens outside this face`
                    : `${card.name} — this project's ${card.name} surface`
                }
              >
                {face ? (
                  <>
                    <AppRing ring={face.ring} />
                    {/* Six or more characters overrun the 44px box at the normal size. */}
                    <span
                      className={`baud-wheel-face-value ${face.absent ? "baud-wheel-face-absent" : ""} ${
                        face.value.length + (face.unit?.length ?? 0) >= 6 ? "baud-wheel-face-long" : ""
                      }`}
                    >
                      {face.value}
                      {face.unit && !face.absent ? <small>{face.unit}</small> : null}
                    </span>
                    <span className="baud-wheel-face-mark">{card.mark}</span>
                  </>
                ) : (
                  card.mark
                )}
                {/* No badge until measured, and none at zero. */}
                {badge === undefined || badge <= 0 ? null : (
                  <span className="baud-wheel-mail baud-wheel-mail-app">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
                {card.kind === "link" ? <span className="baud-wheel-out">↗</span> : null}
              </button>
              <span className="baud-wheel-name">{card.name}</span>
            </div>
          );
        })}
        {shown.map((branch) => {
          // The desktop lamp's precedence: dispatched outranks live, as in BranchChip.
          const word = branch.dispatched ? "dispatched" : branch.interactive ? "live" : "idle";
          const ref = cardRef(branch);
          const away = branch.project && branch.project !== seatedProject ? branch.project : null;
          /** Git adds nothing until known, so the sum can undercount but never invent. */
          const waiting =
            branch.new_mail +
            branch.opened_mail +
            branch.active_plans +
            branch.todo_count +
            (gitCounts[ref] ?? 0);
          return (
            <div
              key={ref}
              className={`baud-wheel-card ${ref === centered ? "baud-wheel-center" : ""} ${
                !away && branch.name === attached ? "baud-wheel-attached" : ""
              }`}
              data-name={ref}
              data-attached={!away && branch.name === attached ? "yes" : undefined}
            >
              <button
                type="button"
                className={`baud-wheel-avatar ${branch.manager ? "baud-wheel-avatar-manager" : ""} ${
                  branch.subagents > 0 ? "baud-wheel-avatar-busy" : ""
                }`}
                title={
                  away
                    ? `${branch.name} — ${word}, in ${away}`
                    : branch.name === attached
                      ? `${branch.name} — the room open below`
                      : `${branch.name} — ${word}`
                }
              >
                {branch.name.slice(0, 2).toUpperCase()}
                <span className={`baud-wheel-dot baud-wheel-dot-${word}`} />
                {waiting > 0 ? (
                  <span className="baud-wheel-mail">{waiting > 99 ? "99+" : waiting}</span>
                ) : null}
              </button>
              <span className="baud-wheel-name">{branch.name}</span>
              {away ? <span className="baud-wheel-home">{away}</span> : null}
            </div>
          );
        })}
      </div>

      {/* The pips are buttons so a gesture the browser swallows never strands the operator on a wheel. */}
      <div className="baud-wheel-stack">
        {WHEELS.map((layered, index) => (
          <button
            key={layered.key}
            type="button"
            className={`baud-wheel-pip ${index === layer ? "baud-wheel-pip-on" : ""}`}
            title={`show ${layered.name}`}
            aria-label={`show ${layered.name}`}
            aria-current={index === layer ? "true" : undefined}
            onClick={() => switchTo(index)}
          />
        ))}
      </div>

      {/* Keyed on the name so a second flick within the fade gets a fresh pill, not a half-faded one. */}
      {flash ? (
        <p key={flash} className="baud-wheel-flash">
          {flash}
        </p>
      ) : null}

      {/* A refusal outranks the empty line: "could not look" must never read as a count of zero. */}
      {held === 0 ? (
        <p className="baud-wheel-empty" title={blocked?.detail || undefined}>
          {blocked?.line ?? wheel.empty}
          {blocked?.detail ? <span className="baud-wheel-empty-why">{blocked.detail}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
