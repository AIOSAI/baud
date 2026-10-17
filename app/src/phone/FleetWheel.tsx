/**
 * The fleet as a wheel - the phone's fleet screen (FPLAN-0423).
 *
 * SHAPE LOCKED BY A THUMB, NOT BY ME. Patrick flicked a live mockup on his S24
 * and approved it in one round ("no tweaks, as is is good"), so
 * `docs/design/wheel_mockup_APPROVED_SHAPE.html` is the spec and this
 * file is its real implementation - matched on behaviour and feel, built with
 * this face's own components and real fleet data. Where I judged something the
 * mockup could not answer, the comment says so; nothing here "improves" the
 * shape, because the shape is the part that was already voted on.
 *
 * WHY A WHEEL AT ALL. The column worked and did not scale: seventeen cards is a
 * scroll-to-find, and the fleet's whole point is knowing at a glance who is
 * awake. A rail makes the entire fleet one flick, and gives the phone something
 * the desktop does not have - a CURRENT agent, the LIT one at the centre, that
 * everything context-bound can follow.
 *
 * VOCABULARY NOTE, because the word outlived the thing: comments below say
 * "under the notch" to mean that centre. The notch was a small arrow drawn
 * beneath the centred card and it was removed 2026-08-21 - the centred card's
 * own accent border and glow say the same thing without the 8px. Where you read
 * "the notch", read "the centre".
 *
 * THE SCROLL IS THE BROWSER'S. `scroll-snap-type: x mandatory` plus native
 * overflow scrolling, deliberately NOT a hand-written pan: momentum, snap
 * physics and accessibility all come free and all feel wrong when reimplemented.
 * This file only PAINTS the consequence of a scroll position - which is also
 * why the terminal's touch handling is untouched by any of it. The rail's
 * gestures are horizontal and native; the room's are vertical and synthesised,
 * and the two never meet on the same element.
 *
 * STACKED WHEELS (FPLAN-0426). The rail became a stack: a vertical flick on it
 * switches which set of agents it holds - "all agents" today, "active" (only
 * dispatched or interactive) one flick up. The rail's box does not change and
 * no control is added, because the point of the round was that the phone is
 * out of room; the gesture IS the filter. The horizontal flick is untouched -
 * `touch-action: pan-x` hands it to the browser before this file ever sees a
 * pointer, so the only movement that reaches the classifier is the vertical
 * one the browser refused. That is not a workaround, it is the reason the
 * feel survives being given a second gesture.
 *
 * THE FOURTH LAYER IS NOT AGENTS (DPLAN-0303, mock approved 08-17). Three
 * wheels hold citizens; the fourth holds APPS - surfaces that belong to the
 * project rather than to anybody in it, git first among them. This is what the
 * stack was built to absorb, and it cost the promised nothing: one more row in
 * the array below, one more pip, one more flash. What it DID need is a second
 * card shape, because "a surface" and "a citizen" must be one glance apart -
 * apps are rounded SQUARES in ember orange, agents stay circles in fleet green,
 * and the accent travels through the pips, the centred card's glow and the
 * flash together so arriving on the apps layer reads as one move rather than
 * four.
 *
 * AN APP CARD IS NEVER THE CURRENT AGENT. It carries no `data-name`, so the
 * centre report that drives the terminal, the sheet and the whole context-bound
 * half of this face never fires on it - flicking down to look at git leaves the
 * agent you were talking to exactly where it was. The apps layer tracks its own
 * centre, locally, for its own tap rule.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { BranchStatus } from "../types";

/** Center scale and edge scale, straight off the approved probe. */
const SCALE_CENTER = 1.28;
const SCALE_SPREAD = 0.38;
/** How much of a card's presence is lost at the rail's edge. */
const FADE = 0.55;

/**
 * Awake, in one boolean, from the two fields that carry it.
 *
 * The rail's DOT is no longer two-state. It launched that way (the approved
 * shape showed one green dot) and live use falsified it in a morning -
 * Patrick, with a dispatch running: "deamon has it green circle. that
 * employes live. like u but thats not the case." A collapsed dot made the
 * machine churning look like someone at the wheel, so the dot now speaks the
 * desktop lamp's own three words: dispatched pulses amber, interactive burns
 * steady green, neither is dim. This boolean survives for the places that
 * only need the coarse word (the sheet's state styling).
 *
 * `has_room` is NOT consulted, deliberately. A room existing means a room
 * exists, not that anyone is in it - deriving a green light from it is exactly
 * the lie the m12 badge work was done to kill.
 */
export const isAwake = (branch: BranchStatus): boolean =>
  branch.dispatched || branch.interactive;

/**
 * One layer of the stack.
 *
 * Patrick's ask was for room, not for a filter menu: "we really are running out
 * of space... maybe a up and down flick with finger on the wheel. so the agent
 * card has other wheels". So the filter IS the gesture and costs no chrome -
 * the rail keeps its exact height whichever layer is showing.
 *
 * ADD A ROW AND YOU ARE DONE. The gesture, the pips and the flash all read
 * their bounds off this array, so an unread-mail or favourites wheel slots in
 * without touching any of them. That was the brief's "keep it open to N".
 */
interface WheelLayerBase {
  key: string;
  /** What flashes over the rail on arrival - the operator's word for it. */
  name: string;
  /** Said out loud when the layer holds nobody. A blank rail is a bug's face. */
  empty: string;
}

interface AgentLayer extends WheelLayerBase {
  holds: "agents";
  /**
   * Which census this layer draws from.
   *
   * "project" is the seated fleet read. "system" is the cross-project roster,
   * which is a DIFFERENT sweep with a different lane behind it - and one that
   * can be absent while the seated read is perfectly healthy. Naming the
   * source here is what lets an unavailable roster refuse on exactly the two
   * wheels that need it, instead of emptying the rail.
   */
  source: "project" | "system";
  hold: (branch: BranchStatus) => boolean;
}

/**
 * The apps layer: cards that are written down, not read from a census.
 *
 * There is no lane behind this list and there should not be one - an app is a
 * surface this face itself provides, so a server that has never heard of it can
 * neither add one nor take one away.
 */
interface AppLayer extends WheelLayerBase {
  holds: "apps";
  cards: ReadonlyArray<AppCard>;
}

/**
 * ONE APP CARD, and the vocabulary that decides what a tap on it does.
 *
 * TWO KINDS, because the mock has two and they are genuinely different
 * promises. A DOOR opens a surface inside this face and comes back with the
 * back chip. A LINK LEAVES - it hands a URL to the phone's own browser and this
 * face is done with it - so it wears a corner arrow, because a card that
 * navigates away and a card that opens a sheet must not look the same before
 * you touch them.
 *
 * ONLY DOORS EXIST THIS ROUND. The mock's REPO and COMMONS cards are link-cards
 * and no lane on this face knows a remote's address yet, so building them would
 * be shipping a door to nowhere. The kind is in the data anyway: a link-card is
 * ONE ENTRY in the array below on the day the lane that resolves a remote URL
 * lands, and nothing else here has to move.
 */
interface AppCard {
  /** Stable id - what a tap reports upward, and what a badge is keyed by. */
  key: string;
  /** Drawn inside the square. Short: this is a 44px box. */
  mark: string;
  /** Under the card, in the agents' own place for a name. */
  name: string;
  kind: "door" | "link";
}

/**
 * WHAT A LIVE APP CARD DRAWS instead of its bare mark - the monitor row's
 * faces (FPLAN-0561 row 3, Patrick's ruling A: live values on the face).
 *
 * The card stays the same card: rail, snap, centre glow and tap-to-centre-
 * then-open are untouched. What it gains is a headline with the mark shrunk to
 * a caption under it, and - for a reading with a range of its own - a ring.
 * The derivation lives in `lib/machine.ts`; this is only the shape it hands in.
 */
export interface AppFace {
  /** The headline, already formatted: "14", "1.3k", or "—" for absent. */
  value: string;
  /** Drawn small beside the value: "%", "°C", "KB/s". */
  unit?: string;
  /** No reading - the dash is drawn in the faint ink, not as a number. */
  absent: boolean;
  /**
   * `none`: no range, so no ring (NET, PROC, a fan with no_range).
   * `dead`: a gauge whose reading is absent - the full track, dimmed.
   * Otherwise the percent of the card's OWN range, and the tone it is drawn in.
   */
  ring: "none" | "dead" | { percent: number; tone: "normal" | "warm" | "hot" };
}

/** A card's outline, traced clockwise from top centre in the 40-unit padding
 *  box INSIDE the card's 2px border - inside, because the rail's headroom is
 *  already spent by the centred card's scale (see phone.css, monitor faces).
 *  `pathLength` 100 makes a percent a dash length directly. */
const RING_PATH = "M20 1H31A8 8 0 0 1 39 9V31A8 8 0 0 1 31 39H9A8 8 0 0 1 1 31V9A8 8 0 0 1 9 1Z";

/** The ring behind a gauge card. SVG attributes, not a style attribute - the
 *  face's no-inline-styles discipline holds with an exact percent. */
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

/**
 * THE STACK, top to bottom. Patrick, on seeing the two-wheel version work:
 * "we really need 3 wheels. current project, live and dispatched. live and
 * dispatched are all project not just the selected project in project
 * selection."
 *
 * LIVE AND DISPATCHED PARTITION THE WORKING SET, they do not overlap - and
 * that is the desktop lamp's precedence doing the dividing, not a second
 * opinion invented here. An agent that is dispatched AND interactive shows as
 * dispatched on its card, so it belongs to the dispatched wheel; putting it on
 * both would make one agent two cards, and putting it only on "live" would
 * contradict the amber dot it is wearing. The consequence is the one devpulse
 * asked for: wheel 2 is all steady green, wheel 3 is all amber pulse, and the
 * wheel's NAME and the card's LIGHT never say different things.
 *
 * THE FOURTH IS NOT A FOURTH WHEEL OF AGENTS. Three wheels is still the answer
 * to "which citizens", and apps sits below them because it answers a different
 * question entirely - it is the end of the stack rather than another filter on
 * it. Deepest is the right place for it: the three an operator flicks between
 * all day stay within one flick of each other.
 */
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
    // Not "no agents" - the fleet is full, the WORKING set is empty, and those
    // are different facts. Saying the wrong one sends someone hunting a bug.
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
    // Unreachable while a card is written down here, and kept anyway: the
    // rail's empty line is what a layer says when it holds nothing, and a
    // layer that could not say it would be the one shape the stack cannot
    // handle.
    empty: "no apps on this face yet",
    holds: "apps",
    cards: [
      {
        key: "git",
        mark: "GIT",
        name: "git",
        kind: "door",
      },
      /* FILES (FPLAN-0443). The second card, and it cost what the comment
         above promised: one row. Patrick, 2026-08-18: "rn I can only see into
         agent files... I cant explore home. or project files outside agents."
         An explorer belongs on this layer for the same reason git does - the
         home directory and a project's own tree are addressed to nobody, so
         there is no citizen to hang them on. */
      {
        key: "files",
        mark: "FILES",
        name: "files",
        kind: "door",
      },
      /* BACKUP (DPLAN-0411). The owner, 2026-10-16: "in the apps wheel in
         baud id like backup in there, i open the card and i see my click
         options, i can backup from baud." A project's store is addressed to
         nobody either, so it sits beside git and files. BKP, not BACKUP: six
         letters are wider than FILES, the widest mark this square holds. */
      {
        key: "backup",
        mark: "BKP",
        name: "backup",
        kind: "door",
      },
    ],
  },
  /**
   * THE MACHINE, and it is LAST because last is now the closest place.
   *
   * Patrick, 2026-08-20: *"the monitor's kind of like a quick flick - how's the
   * computer doing, sometimes the fans are going crazy and the screen is locked
   * and it's all the way across the room. Because I'm on the phone, so it'd be
   * nice to have that at my fingertips."*
   *
   * Deepest row = one BACKWARD flick from the resting position, now that the
   * stack loops (see `stepBy`). The two facts are one decision and neither
   * works alone: bury it at the bottom of a bounded stack and it is the most
   * expensive row on the face; add the loop and it becomes the cheapest.
   *
   * IT IS AN APP LAYER, not a new kind of thing, and that is the whole reason
   * this round is small. A monitor sounds like a readout rather than a rail -
   * but CPU, memory, temperature, fan, network, processes and battery ARE cards, so they get the
   * rail, the snap, the centre glow and the tap-to-centre-then-open that the
   * app layer already has. Zero new rendering. Patrick described the same shape
   * from the other side: *"we scroll left or right... and then I can possibly
   * open in a tab the actual system monitor where it shows all the processes."*
   *
   * LIVE ON THE FACE since FPLAN-0561 row 3 (Patrick, 2026-09-12: *"a big 100%
   * door a. live on face"*; *"6th card is in."* - FAN, the case he named). Each
   * card carries its headline and a gauge card a ring = percent of its own
   * range, from `GET /v1/machine` - @skills' reading, proxied by @api, read
   * only while this row is the visible wheel. An absent reading draws a dash,
   * never a zero: a monitor that invents a number is worse than no monitor,
   * because the whole point is trusting it from across the room. The keys are
   * stable - the sheet keys on them - and FAN sits between TEMP and NET.
   * The order: CPU, MEM, TEMP, FAN, NET, PROC, BAT.
   */
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

/**
 * How far a finger travels down or up before the drag stops being a slip of
 * the thumb and becomes a wheel switch. Deliberately larger than a tap's
 * wobble and smaller than a comfortable flick.
 */
const SWITCH_PX = 30;

/** How long the arriving wheel's name stays legible before it fades out. */
const FLASH_MS = 1100;

/** One card's identity, across every project. See `centered` below. */
export const cardRef = (branch: BranchStatus): string => `${branch.project}/${branch.name}`;

/**
 * THE CARD A WHEEL OPENS ON, when nothing has been chosen yet.
 *
 * Patrick, this morning: "when I load up, the agent seat sits on the first
 * agent - so ai_mail in aipass. I want it to sit on the manager agent." The
 * rail opened at scroll zero, and scroll zero is not a decision - it is
 * whichever agent sorts first, which is nobody in particular. The manager is
 * the one agent every project HAS and the one an operator arrives to talk to,
 * so it is what an unchosen wheel presents.
 *
 * MANAGER-NESS IS A FIELD, NEVER A NAME. `BranchStatus.manager` is the
 * passport's `identity.citizen_class` already asked this exact question
 * (types.ts:9) - the same boolean the card's blue avatar ring reads two hundred
 * lines below and the sheet's MANAGER stamp reads in PassportSheet. Nothing
 * here re-derives it from a branch name, so a project whose manager is not
 * named after it opens correctly, and a rename can never silently move the
 * default.
 *
 * SEATED PROJECT ONLY, which is what keeps this honest on the cross-project
 * wheels: a foreign manager is somebody else's owner, and opening on one would
 * be a wheel that starts in a project the phone is not sitting in.
 *
 * TWO MANAGERS is the census's own order - the first one it hands over, no
 * tie-break invented here. NO MANAGER is silent and lands exactly where the
 * rail landed before: the first card. A project mid-birth, or a passport that
 * will not read, is not a fault worth saying out loud on a 64px card.
 */
export const openingCard = (
  cards: readonly BranchStatus[],
  seatedProject: string,
): BranchStatus | undefined =>
  cards.find((card) => card.manager && card.project === seatedProject) ?? cards[0];

interface FleetWheelProps {
  branches: BranchStatus[];
  /**
   * The cross-project working set, or NULL when that lane is unavailable.
   *
   * Null and empty are different answers and the rail says which: null is "I
   * could not look", empty is "nobody is working". Collapsing them would put a
   * confident "no one live" on screen while the whole system was busy.
   */
  roster: BranchStatus[] | null;
  /**
   * Why the roster is missing, when it is.
   *
   * TWO PARTS, because Patrick read the one-part version as "a strange
   * warning??". `line` is what the rail says out loud and it is deliberately
   * short and calm - a lane that has not shipped yet is not a fault, and a
   * sentence long enough to look like a stack trace reads as one. `detail`
   * is the whole reason, kept a long-press away. Nothing is hidden; the
   * volume is what changed.
   */
  rosterRefusal: { line: string; detail: string } | null;
  /** The project the phone is seated in - what makes a card foreign or not. */
  seatedProject: string;
  /**
   * Changed-file counts by card ref, from PhoneApp's slow git sweep - and
   * ABSENT for every branch the sweep has not reached yet.
   *
   * The absence is the contract, which is why this is a sparse map and not a
   * number per card. The fleet read carries mail, plans and todos for free;
   * git is a subprocess per branch and arrives late, one branch at a time. A
   * card with no entry adds nothing to its badge rather than adding a zero,
   * because zero is a FACT about a working tree - "nothing has changed here" -
   * and a lane that has not answered yet must not be able to say it.
   */
  gitCounts: Readonly<Record<string, number | undefined>>;
  /**
   * The card under the notch, as `PROJECT/name`.
   *
   * A NAME IS NOT AN IDENTITY once the rail crosses projects. Eleven projects
   * share a naming convention, so `devpulse` names one agent in AIPASS and can
   * name another somewhere else; centring by name would open whichever card the
   * seated read happened to hold. The ref is the key the cards were always
   * built with, promoted to the thing that travels.
   */
  centered: string | null;
  /**
   * The agent whose room is open in the terminal below, if any.
   *
   * THIS IS WHERE THE SPLIT-NAMING WENT. The standing strip used to spell it out
   * - "the room below stays attached to X" - and that sentence died with the
   * strip, but the FACT it carried cannot: browsing away from an attached room
   * and seeing no acknowledgement anywhere reads as a flick that failed to
   * switch. So the fact moved from a row of text to a mark on the card itself.
   * Zero standing cost, always visible, and spatial rather than verbal - the
   * ring points at the room that is literally underneath it.
   */
  attached: string | null;
  /**
   * What each APP card's badge should read, by card key - and absent for a
   * count nothing has measured yet.
   *
   * Sparse for the same reason `gitCounts` is: the git app's number is a repo
   * -wide `git status` on a slow timer, so a badge that drew a zero before the
   * first answer would say the repository is clean on the strength of a read
   * that never happened.
   */
  appBadges: Readonly<Record<string, number | undefined>>;
  /**
   * What each APP card's face should draw instead of its bare mark, by card
   * key - and absent for a card with nothing measured to show. The monitor row
   * is the only layer that has any today (FPLAN-0561).
   */
  appFaces: Readonly<Record<string, AppFace | undefined>>;
  /** Which layer is showing, by key, whenever it changes. The shell reads the
   *  machine only while this is the monitor row - the wheel owns the stack, so
   *  the wheel is what says where it is. */
  onLayer: (key: string) => void;
  onCenter: (name: string) => void;
  /** A tap on the card that is ALREADY centered - the only way in. */
  onExpand: (name: string) => void;
  /** The same two-touch rule, for an app card: centre first, then open. */
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
  /** The whole wheel - the drag surface, and the element that must out-argue
   *  the browser's pull-to-refresh. See the touch effect below. */
  const wrap = useRef<HTMLDivElement | null>(null);
  /** Last name reported upward, so a scroll frame that changes nothing is free. */
  const reported = useRef<string | null>(null);
  /** The same guard for the apps layer's local centre - one setState per real
   *  change, never one per animation frame of a flick. */
  const appReported = useRef<string | null>(null);
  /** Which app card is under the notch, by key. Null on every agent wheel. */
  const [appCentered, setAppCentered] = useState<string | null>(null);

  /** Which layer of the stack is showing. Index into WHEELS, never a name. */
  const [layer, setLayer] = useState(0);
  /** The arriving wheel's name, on screen briefly. Null between switches. */
  const [flash, setFlash] = useState<string | null>(null);
  /**
   * Where each wheel was left, by key.
   *
   * A wheel that forgets its place is a wheel you have to re-find your way
   * around every time you glance at the other one - and the whole point of the
   * rail is that the fleet is spatially stable. Kept in a ref, not state:
   * restoring a scroll offset must not be a render.
   */
  const memory = useRef<Record<string, number>>({});
  /** Where the current drag started, or null when no finger is down. */
  const drag = useRef<{ x: number; y: number } | null>(null);
  /**
   * This gesture already switched a wheel, so the click it ends with is not a
   * tap. Without this a flick that lands on a card would ALSO select it - and
   * on the centred card that is a launch nobody asked for.
   */
  const swiped = useRef(false);

  const wheel = WHEELS[layer];
  /** The layer's agent half, or null on the apps layer - which has no census,
   *  no roster to be refused by, and no filter to run. */
  const citizens = wheel.holds === "agents" ? wheel : null;
  /** The layer's app cards, or null on every agent wheel. */
  const apps = wheel.holds === "apps" ? wheel.cards : null;
  /** Null ONLY when a system wheel has no lane to read - never when it is empty. */
  const census = citizens ? (citizens.source === "system" ? roster : branches) : [];
  const shown = useMemo(
    () => (citizens ? (census ?? []).filter(citizens.hold) : []),
    [census, citizens],
  );
  /** What replaces the cards when the lane itself is missing.
   *
   *  NO REFUSAL YET MEANS NO ANSWER YET (DPLAN-0414 A#25). Every failed roster
   *  read records a refusal (lib/pollers.ts), so a null roster with a null
   *  refusal is only ever the cold load before the first answer - and it used
   *  to say "lane pending", a schedule, over a read that was simply still out.
   *  It says "reading…" with no reason line; "lane pending" and "roster
   *  unavailable" still come from the refusal itself, unchanged. */
  const blocked =
    census === null ? (rosterRefusal ?? { line: "reading…", detail: "" }) : null;
  /** How many cards the rail is actually holding, whichever kind they are -
   *  what the empty line, the ghost card and the paint effect all key on. */
  const held = apps ? apps.length : shown.length;

  /* Say which layer is showing. Keyed on the layer's key, not the index, so a
     render that changes nothing reports nothing. */
  const layerKey = wheel.key;
  useEffect(() => onLayer(layerKey), [onLayer, layerKey]);

  /**
   * Paint the wheel for the current scroll position.
   *
   * Imperative on purpose. This runs on every animation frame of a flick, and
   * seventeen React re-renders per frame to set a transform would drop the
   * feel Patrick approved. State goes up ONLY when the centered card actually
   * changes - which is a real event the rest of the face cares about, not a
   * per-frame one.
   */
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

    /* THE APPS LAYER'S OWN CENTRE, and it stays inside this component.
       An app is not an agent, so it must not travel up as one - the centre
       report drives the terminal, the sheet and the passport, and every one of
       them takes a `project/branch` ref. What the apps layer needs the centre
       for is only the two-touch rule and the ring, which is a local matter.
       Set through state rather than a class written here, because the ring is
       drawn in the render like every other card's. */
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
      // One paint per frame, however many scroll events the browser fires.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        paint();
      });
    };
    strip.addEventListener("scroll", onScroll, { passive: true });
    // The rail is also re-laid-out by rotation and by the keyboard opening.
    const observer = new ResizeObserver(() => paint());
    observer.observe(strip);
    paint();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      strip.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
    // The VISIBLE count, not the fleet's: an agent going idle empties a card
    // off the active wheel while `branches.length` sits perfectly still.
  }, [paint, held]);

  /**
   * Land on the new wheel where it was left.
   *
   * Layout effect, not effect: the cards are already swapped by the time this
   * runs and the browser has not painted yet, so the restore is invisible. As
   * an ordinary effect it is a visible jump from 0 to the remembered offset.
   */
  useLayoutEffect(() => {
    const strip = rail.current;
    if (!strip) return;
    strip.scrollLeft = memory.current[WHEELS[layer].key] ?? 0;
    paint();
  }, [layer, paint]);

  /**
   * WHAT COUNTS AS A WHEEL THAT HAS NEVER BEEN OPENED.
   *
   * The project wheel is keyed per SEAT: a project switch replaces every card on
   * it, so where it was left points at agents that are not there any more and
   * means nothing - that is a wheel being opened for the first time, again. The
   * system wheels are keyed by wheel alone, because a project switch does not
   * move one card on them; where the operator left them still means exactly what
   * they left it meaning, and re-placing those would be moving the rail under a
   * hand that put it there.
   *
   * THE APPS LAYER IS KEYED BY ITSELF, like the system wheels and for the
   * stronger version of their reason: its cards are written down, so a project
   * switch cannot move one of them at all.
   */
  const placeKey = `${wheel.key}:${citizens?.source === "project" ? seatedProject : ""}`;
  /**
   * Wheels already given their opening position, by placement key. A ref, not
   * state: placing is a scroll and never a render - and the whole point is that
   * it happens ONCE per key, so it must not be able to re-run itself.
   */
  const placed = useRef<Record<string, boolean>>({});

  /**
   * THE OPENING PLACEMENT - the manager under the notch, and nothing after that.
   *
   * This is the one place the "first card" default used to live, as the `?? 0`
   * directly above; `openingCard` now decides what an unchosen wheel presents.
   * It cannot be done in that effect alone, because on a cold load the rail is
   * a ghost card - the fleet read has not landed - so the placement has to wait
   * for cards to exist rather than for a layer to change.
   *
   * HANDS OUTRANK IT, ALWAYS AND BY CONSTRUCTION. The key is marked spent the
   * instant a card is placed, so every later run - and there is one per poll
   * tick, since a fresh roster is a fresh array - returns on the first line. A
   * flick, a tap, an agent waking or going idle: none of them can move the rail
   * back. Nothing re-centres; this only fills the ABSENCE of a choice.
   *
   * An empty wheel is deliberately NOT marked spent. Marking it would burn the
   * one shot on a rail that is still waiting for its first read, which is
   * exactly the load this exists for.
   */
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
    // paint()'s own measurement, deliberately: the card the rail settles on has
    // to be the card the notch marks, and two different centre calculations are
    // two chances to disagree by a pixel and land one card over. `scrollIntoView`
    // is not used - it is allowed to scroll ANCESTORS, and this runs while the
    // page is still arriving.
    const box = card.getBoundingClientRect();
    const middle = strip.getBoundingClientRect().left + strip.clientWidth / 2;
    strip.scrollLeft += box.left + box.width / 2 - middle;
    paint();
  }, [placeKey, seatedProject, shown, paint]);

  /** The flash is a moment, not a state - it clears itself. */
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);

  /**
   * Go to a layer by its INDEX. Absolute, and still bounded - a pip tap names
   * a real position, so an out-of-range index here is a bug, not a gesture.
   * The wrapping lives one function down, where the relative moves are.
   */
  const switchTo = useCallback(
    (next: number) => {
      if (next === layer || next < 0 || next >= WHEELS.length) return;
      const strip = rail.current;
      // Remember where THIS wheel sits before its cards go away.
      if (strip) memory.current[WHEELS[layer].key] = strip.scrollLeft;
      // The centre is about to be a different card, and possibly no card at
      // all. Clearing the mirror is what makes paint() re-report on arrival -
      // without it the face keeps following an agent that is no longer shown.
      reported.current = null;
      setLayer(next);
      setFlash(WHEELS[next].name);
    },
    [layer],
  );

  /**
   * Move `delta` layers from wherever we are. The touch lane's one verb.
   *
   * IT IS A LOOP NOW - Patrick's ruling 2026-08-20, and it OVERTURNS what stood
   * here. The old rule was "ENDS, NOT A LOOP": two stacked pips draw a stack, a
   * stack has a top and a bottom, and wrapping makes the pip jump the length of
   * the indicator on what felt like one more nudge in the same direction. That
   * observation is still true and is not what decided it.
   *
   * What decided it is that the last layer and the first are now ONE FLICK
   * APART, and the monitor was put last precisely to collect that. From the
   * resting position (the seated project) the machine's vitals are a single
   * backward flick, where a bounded stack would have charged four forward ones
   * for the deepest row. Patrick's case for it is the one that matters: *"the
   * fans going crazy and the screen is locked and it's all the way across the
   * room, and I'm on the phone"* - a glance that costs four gestures is not a
   * glance. A wheel that stops is a list; this one is named a wheel.
   *
   * The modulo is written twice on purpose: JS `%` keeps the sign of the left
   * operand, so a single `%` sends a backward step off the bottom to -1 instead
   * of to the last layer.
   *
   * The PIPS still draw a ladder and so the dot still leaps on the lap. Left
   * that way deliberately: which layer you are on is the true thing they say,
   * and they say it correctly. If the leap reads wrong under a thumb, the fix
   * is to draw them as a ring rather than to take the loop away.
   */
  const stepBy = useCallback(
    (delta: number) => {
      const count = WHEELS.length;
      switchTo(((layer + delta) % count + count) % count);
    },
    [layer, switchTo],
  );

  /**
   * THE VERTICAL FLICK, ON A NON-PASSIVE TOUCH LISTENER.
   *
   * Patrick, third test, naming the mechanism himself: "u where right a refresh
   * gesture is in place at the ladt wheel. I guess preventing me from grabbing
   * the wheels." The browser's PULL-TO-REFRESH was taking the downward swipe
   * before this code ever saw it, which is why the rail felt like a one-way
   * door - up had no competing browser gesture, down had the strongest one on
   * the platform.
   *
   * TWO EARLIER ANSWERS WERE BOTH REAL AND BOTH INSUFFICIENT. The wrap-not-rail
   * surface fix (last round) closed a genuine hole - a refusing wheel's only
   * visible element sat outside every listener - but a listener cannot classify
   * a gesture the browser already owns. And `overscroll-behavior-y: contain` on
   * html/body, which won this fight once before, wins it only in Chrome: Chrome
   * implements pull-to-refresh as scroll CHAINING out of the document, so
   * containing the chain kills it, while `contain` by definition PRESERVES an
   * element's own overscroll affordance. Firefox - the acceptance browser -
   * treats the refresh as exactly that affordance. That is now `none`, in the
   * CSS, with the correction written where the wrong claim was.
   *
   * So the gesture is claimed here, in code, where nothing can be polite about
   * it: a native `touchmove` bound `{ passive: false }`, calling
   * `preventDefault()` the moment the drag LEANS vertical - long before it is
   * far enough to be a switch. Waiting for the 30px threshold would be arriving
   * after the argument is over, because the browser decides on its first
   * touchmove. React's own onTouchMove cannot do this job: it is delegated and
   * passive, and a passive listener's preventDefault is ignored with a console
   * warning.
   *
   * HORIZONTAL IS NEVER TOUCHED. The only moves this cancels are the ones where
   * |dy| > |dx|; the rail's native pan is the feel Patrick approved and it stays
   * entirely the browser's.
   */
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
      // Claim it FIRST, decide about it second.
      if (event.cancelable) event.preventDefault();
      if (Math.abs(dy) < SWITCH_PX) return;
      // One switch per gesture: dropping the origin ends this drag's authority,
      // so a long finger-drag cannot ride through the whole stack in one go.
      drag.current = null;
      swiped.current = true;
      // Flick UP to go deeper into the stack, the direction a list moves under
      // the finger that pushes it.
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

  /**
   * The same gesture for anything that is not a finger.
   *
   * Kept separate and gated on `pointerType` rather than merged: touch input
   * raises BOTH pointer and touch events, and one gesture must not be able to
   * count twice. Nothing on a phone comes through here - it is the desktop
   * browser's mouse-drag, so the face stays testable off the device.
   */
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

  /**
   * ONE GESTURE IS SELECT. A tap on an off-centre card glides it under the
   * notch and opens NOTHING - so a thumb reaching across the rail can never
   * launch anything by accident. Only a tap on the card already centred opens
   * it, which means every launch takes two deliberate touches.
   */
  const onTap = (event: React.MouseEvent<HTMLDivElement>) => {
    // A gesture that switched wheels ends in a click like any other. It is not
    // a tap, and it must not select - let alone launch - the card it happens
    // to finish over. Cleared on the next pointerdown, not here, because the
    // click arrives AFTER the pointerup that ended the swipe.
    if (swiped.current) return;
    const card = (event.target as HTMLElement).closest<HTMLElement>(".baud-wheel-card");
    if (!card) return;

    // THE SAME TWO TOUCHES FOR AN APP, tested first because an app card carries
    // no `data-name` and would otherwise fall out of this function unread.
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
      /* THE ACCENT IS SET ON THE WHOLE WHEEL, not on the cards - so the notch,
         the pips and the centred card's ring all change colour together and the
         layer switch reads as ONE move rather than three. Every element that
         carries the accent lives inside this box, which is why one class here
         is the whole shift. */
      className={`baud-wheel-wrap ${apps ? "baud-wheel-wrap-apps" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the
          cards inside are buttons; this is one delegated listener over them. */}
      <div ref={rail} className="baud-wheel" onClick={onTap}>
        {/* THE RAIL'S HEIGHT IS A CARD, ALWAYS - so an empty wheel cannot make
            the layout jump under the flick that arrived at it. A real card
            holds the space rather than a hand-copied pixel count that would
            drift the next time the card resizes. It carries no data-name, so
            paint() finds it and reports nothing, which is the honest answer
            for a wheel with nobody on it. */}
        {held === 0 ? (
          <div className="baud-wheel-card baud-wheel-ghost" aria-hidden="true">
            <span className="baud-wheel-avatar" />
            <span className="baud-wheel-name">—</span>
          </div>
        ) : null}
        {/* THE APP CARDS - the same card, the same rail, the same snap and the
            same centre glow, drawn as SQUARES so one glance separates a surface from
            a citizen without reading a word. No dot: a lamp answers "is anyone
            awake in there", and there is nobody in a git repository.
            `data-app` instead of `data-name` is what keeps this layer out of
            the current-agent report - see the file header. */}
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
                {/* A LIVE FACE: the headline, the mark as its caption, and the
                    ring when the reading has a range. No face: the bare mark. */}
                {face ? (
                  <>
                    <AppRing ring={face.ring} />
                    {/* A LONG FACE - "999KB/s", "3.6krpm" - steps its type down,
                        measured in headless Chrome against the built CSS: at the
                        normal size six characters or more overran the 44px box. */}
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
                {/* ABSENT UNTIL MEASURED, and absent at zero too - the agent
                    cards' own rule, for the agent cards' own reason: a badge is
                    a "how much" and a nought is not one. The two absences are
                    NOT the same fact, and the card behind this one tells them
                    apart: a measured zero prints as 0 on the sheet, an
                    unmeasured one prints nothing at all. */}
                {badge === undefined || badge <= 0 ? null : (
                  <span className="baud-wheel-mail baud-wheel-mail-app">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
                {/* The link-card's tell: a corner arrow means this one does not
                    open a sheet, it leaves. Door-cards wear nothing. */}
                {card.kind === "link" ? <span className="baud-wheel-out">↗</span> : null}
              </button>
              <span className="baud-wheel-name">{card.name}</span>
            </div>
          );
        })}
        {shown.map((branch) => {
          // The desktop lamp's own precedence: a dispatch outranks the
          // interactive word on the same card, exactly as in BranchChip.
          const word = branch.dispatched ? "dispatched" : branch.interactive ? "live" : "idle";
          const ref = cardRef(branch);
          // An agent from somewhere else. Named on the card rather than left to
          // be discovered at the door, because "which project is this" is the
          // question a cross-project wheel creates and it has to answer it.
          const away = branch.project && branch.project !== seatedProject ? branch.project : null;
          /**
           * EVERYTHING WAITING ON THIS AGENT, in one number - Patrick's ruling
           * (2026-08-17): the badge counted unread mail alone while the face
           * tracked four attention items per agent, so his own card read 1
           * where thirty-nine things were outstanding. A badge that reports one
           * quarter of the answer is worse than no badge, because a glance
           * BELIEVES it.
           *
           * OPENED MAIL IS STILL WAITING. Opened is not closed - the message
           * was read and the work it asked for has not been done - and the
           * fleet dashboard's own summary counts it in exactly this column.
           * Leaving it out would make the pocket and the desk disagree about
           * the same inbox.
           *
           * GIT IS THE ONE THAT CAN BE ABSENT, and absence here means absent:
           * a branch the sweep has not reached, one with no git, and one whose
           * read refused all add nothing at all. The number stays the sum of
           * what is KNOWN, which is why it can only ever be an undercount and
           * never an invention. The exact figure, and any refusal behind it,
           * live on the card - a badge is a "how much", the card is the "what".
           */
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
              {/* Same two marks the desk now wears, same rulings: manager
                  centre BLUE (Patrick: not red - ownership is not an alarm),
                  sub-agents flashing RED, because work inside a session the
                  process table cannot show is worth the glance. One fleet,
                  two faces, one vocabulary. */}
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
                {/* Nothing waiting, no badge: a zero is noise on a rail this
                    size, and it is the one number the operator never has to
                    act on. Capped at 99+ like the header bell's, for the same
                    reason - past two digits a badge stops being a glance and
                    starts being a label that does not fit on a 64px card. */}
                {waiting > 0 ? (
                  <span className="baud-wheel-mail">{waiting > 99 ? "99+" : waiting}</span>
                ) : null}
              </button>
              <span className="baud-wheel-name">{branch.name}</span>
              {/* Only where it is news. On the seated project's own wheel every
                  card would wear the same tag, which is noise on a 64px card. */}
              {away ? <span className="baud-wheel-home">{away}</span> : null}
            </div>
          );
        })}
      </div>
      {/* THE NOTCH STOOD HERE and is gone (Patrick, 2026-08-21) - the arrow
          under the centre. Its job was to name the centre as a PLACE, so the
          fleet has a current agent rather than a scrolled list, and that job is
          not being dropped: `.baud-wheel-center` already gives the centred card
          an accent border, a glow and brighter name ink. Two marks, one
          question, and the arrow was the quiet one paying 8px of vertical rent
          on a face where the terminal wants every row. His words: "when I hold
          a card it just lights up anyway, so that arrow is basically real
          estate we don't need." */}

      {/* WHICH WHEEL AM I ON is never allowed to be a mystery, and it is
          answered twice on purpose. The pips are standing and silent - they
          say where you are in the stack at a glance, forever. The flash is
          momentary and verbal - it says what you just arrived at, in the one
          second you are asking. Either alone leaves a hole: pips with no
          vocabulary do not name the filter, and a flash that has faded leaves
          nothing behind.

          THE PIPS ARE NOW BUTTONS, and that is deliberate insurance rather
          than a second control. A gesture is arbitrated by the browser - it
          can be claimed, cancelled or swallowed, and when it is there is
          nothing left to press and no way to say so. Patrick was STUCK on a
          wheel, which is the worst thing a filter can do. A tap cannot be
          arbitrated away, so the stack now always has a floor under it. The
          gesture stays the way it is meant to be used; this is the way out
          when the gesture does not land. */}
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

      {/* The pill's look is the approved mock's, ruled "much much improved"
          against the old dim-ink whisper - see .baud-wheel-flash in phone.css.
          KEYED ON THE NAME so a second flick inside the same second gets its
          own fade: without the key React reuses this node, the new layer's
          name lands in a pill that is already half faded out, and the flick
          that most needs an answer is the one that gets the weakest. */}
      {flash ? (
        <p key={flash} className="baud-wheel-flash">
          {flash}
        </p>
      ) : null}

      {/* "Could not look" outranks "nobody there" - a refusal must never be
          served as a confident count of zero. Both are said in the same quiet
          voice: an unshipped lane and an empty wheel are equally not-a-fault,
          and the one thing neither may do is look like an alarm. */}
      {/* THE DETAIL IS ON THE FACE NOW (DPLAN-0414 A#14). It was "one
          long-press away" in a title, and a touch screen never shows a title -
          so "roster unavailable" stood alone with its reason unreachable. The
          short word keeps its place and the reason sits under it, smaller,
          in the same quiet voice. The title stays. */}
      {held === 0 ? (
        <p className="baud-wheel-empty" title={blocked?.detail || undefined}>
          {blocked?.line ?? wheel.empty}
          {blocked?.detail ? <span className="baud-wheel-empty-why">{blocked.detail}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
