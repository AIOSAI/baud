/**
 * The fleet as a wheel - the phone's fleet screen (FPLAN-0423).
 *
 * SHAPE LOCKED BY A THUMB, NOT BY ME. Patrick flicked a live mockup on his S24
 * and approved it in one round ("no tweaks, as is is good"), so
 * `dropbox/wheel_round/wheel_mockup_APPROVED_SHAPE.html` is the spec and this
 * file is its real implementation - matched on behaviour and feel, built with
 * this face's own components and real fleet data. Where I judged something the
 * mockup could not answer, the comment says so; nothing here "improves" the
 * shape, because the shape is the part that was already voted on.
 *
 * WHY A WHEEL AT ALL. The column worked and did not scale: seventeen cards is a
 * scroll-to-find, and the fleet's whole point is knowing at a glance who is
 * awake. A rail makes the entire fleet one flick, and gives the phone something
 * the desktop does not have - a CURRENT agent, the one under the notch, that
 * everything context-bound can follow.
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
interface WheelLayer {
  key: string;
  /** What flashes over the rail on arrival - the operator's word for it. */
  name: string;
  /** Said out loud when the layer holds nobody. A blank rail is a bug's face. */
  empty: string;
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
 */
const WHEELS: ReadonlyArray<WheelLayer> = [
  {
    key: "project",
    name: "current project",
    empty: "this project has no agents",
    source: "project",
    hold: () => true,
  },
  {
    key: "live",
    name: "live",
    // Not "no agents" - the fleet is full, the WORKING set is empty, and those
    // are different facts. Saying the wrong one sends someone hunting a bug.
    empty: "no one live",
    source: "system",
    hold: (branch) => branch.interactive && !branch.dispatched,
  },
  {
    key: "dispatched",
    name: "dispatched",
    empty: "nothing dispatched",
    source: "system",
    hold: (branch) => branch.dispatched,
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
  onCenter: (name: string) => void;
  /** A tap on the card that is ALREADY centered - the only way in. */
  onExpand: (name: string) => void;
}

export default function FleetWheel({
  branches,
  roster,
  rosterRefusal,
  seatedProject,
  centered,
  attached,
  onCenter,
  onExpand,
}: FleetWheelProps) {
  const rail = useRef<HTMLDivElement | null>(null);
  /** The whole wheel - the drag surface, and the element that must out-argue
   *  the browser's pull-to-refresh. See the touch effect below. */
  const wrap = useRef<HTMLDivElement | null>(null);
  /** Last name reported upward, so a scroll frame that changes nothing is free. */
  const reported = useRef<string | null>(null);

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
  /** Null ONLY when a system wheel has no lane to read - never when it is empty. */
  const census = wheel.source === "system" ? roster : branches;
  const shown = useMemo(() => (census ?? []).filter(wheel.hold), [census, wheel]);
  /** What replaces the cards when the lane itself is missing. */
  const blocked =
    census === null
      ? (rosterRefusal ?? { line: "lane pending", detail: "the cross-project roster is unavailable" })
      : null;

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
  }, [paint, shown.length]);

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

  /** The flash is a moment, not a state - it clears itself. */
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);

  /**
   * Move up or down the stack.
   *
   * ENDS, NOT A LOOP. Two stacked pips draw a stack, and a stack has a top and
   * a bottom - wrapping would make the pips jump the length of the indicator
   * on what felt like one more nudge in the same direction. Out-of-range is a
   * no-op, which is what the edge of a stack does.
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

  /** Move `delta` layers from wherever we are. The touch lane's one verb. */
  const stepBy = useCallback((delta: number) => switchTo(layer + delta), [layer, switchTo]);

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
    const name = card?.dataset.name;
    if (!card || !name) return;
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
      className="baud-wheel-wrap"
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
        {shown.length === 0 ? (
          <div className="baud-wheel-card baud-wheel-ghost" aria-hidden="true">
            <span className="baud-wheel-avatar" />
            <span className="baud-wheel-name">—</span>
          </div>
        ) : null}
        {shown.map((branch) => {
          // The desktop lamp's own precedence: a dispatch outranks the
          // interactive word on the same card, exactly as in BranchChip.
          const word = branch.dispatched ? "dispatched" : branch.interactive ? "live" : "idle";
          const ref = cardRef(branch);
          // An agent from somewhere else. Named on the card rather than left to
          // be discovered at the door, because "which project is this" is the
          // question a cross-project wheel creates and it has to answer it.
          const away = branch.project && branch.project !== seatedProject ? branch.project : null;
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
                {/* Unread mail only. A zero badge is noise on a rail this size,
                    and the count is on the expanded card either way. */}
                {branch.new_mail > 0 ? <span className="baud-wheel-mail">{branch.new_mail}</span> : null}
              </button>
              <span className="baud-wheel-name">{branch.name}</span>
              {/* Only where it is news. On the seated project's own wheel every
                  card would wear the same tag, which is noise on a 64px card. */}
              {away ? <span className="baud-wheel-home">{away}</span> : null}
            </div>
          );
        })}
      </div>
      {/* The notch is the whole reason the wheel reads as a wheel: it names the
          centre as a PLACE, so the fleet has a current agent rather than just a
          scrolled list. */}
      <div className="baud-wheel-notch" />

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

      {flash ? <p className="baud-wheel-flash">{flash}</p> : null}

      {/* "Could not look" outranks "nobody there" - a refusal must never be
          served as a confident count of zero. Both are said in the same quiet
          voice: an unshipped lane and an empty wheel are equally not-a-fault,
          and the one thing neither may do is look like an alarm. */}
      {shown.length === 0 ? (
        <p className="baud-wheel-empty" title={blocked?.detail}>
          {blocked?.line ?? wheel.empty}
        </p>
      ) : null}
    </div>
  );
}
