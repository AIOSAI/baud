/* The corner overlay on a tab: the pulse with its ×, and Looking at's resolver, whose lines go to the side panel
   through the worker. Nothing is drawn or sent until the panel switches Interact on for this tab; × turns it off.
   It never calls the host: its origin is the page's. Built as a classic script, since content scripts are not modules. */

import { clampPlace, placeKey, type Place } from "./lib/place";
import { pageId, pageTitle, selectionText, what } from "./lib/look";
import { asWorkerToTab, DEFAULT_EYES, PING_MS, TAB_PORT, type LookKind, type TabToWorker, type WorkerToTab } from "./messages";
import { makePulse } from "./pulse";
import { tokens } from "../tokens";

const CTX_WAIT = 150;
const PULSE_DRAG = 8;
const FPS = 15;
const SIZE = 140;

type State = Extract<WorkerToTab, { type: "state" }>;

function start() {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}) =>
    Object.assign(document.createElement(tag), props);

  // Inline on the host on purpose: page CSS outranks `:host`, and `all: initial` is the only reliable fence here.
  const host = document.createElement("baud-pulse");
  const root = host.attachShadow({ mode: "closed" });
  host.style.cssText = "all: initial; position: fixed; top: 8px; right: 8px; z-index: 2147483647;";
  root.append(
    el("style", {
      textContent: `
    :host { font: 500 10px/1 system-ui, sans-serif; }
    .wrap { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    canvas { width: ${SIZE}px; height: ${SIZE}px; cursor: grab; touch-action: none; box-sizing: border-box; border: 1px solid ${tokens.line}; border-radius: 10px; background: ${tokens.bg}; }
    .bar { display: flex; gap: 4px; }
    .bar a { padding: 3px 7px; border: 1px solid ${tokens.line}; border-radius: 999px; color: ${tokens.inkDim}; background: ${tokens.bg}; cursor: pointer; user-select: none; }
    .ghost { position: fixed; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; pointer-events: none; background: ${tokens.green}; }
  `,
    }),
  );
  const canvas = el("canvas");
  const close = el("a", { textContent: "×", title: "Click: Interact off for this tab. Hold and drag: move the pulse" });
  const bar = el("div", { className: "bar" });
  const wrap = el("div", { className: "wrap" });
  bar.append(close);
  wrap.append(canvas, bar);
  root.append(wrap);
  canvas.width = canvas.height = Math.round(SIZE * Math.min(2, devicePixelRatio || 1));

  // the loop runs the whole time Interact is on: the pulse is the owner's live view of the fleet from across the room
  const draw = makePulse(canvas);
  const t0 = performance.now();
  let st: State = { type: "state", mode: "idle", speaker: 0, eyes: DEFAULT_EYES, interact: false, rings: [] };
  let raf = 0;
  let drawnAt = 0;
  let port: chrome.runtime.Port | null = null;
  const frame = (now: number) => {
    drawnAt = now;
    draw({ mode: st.mode, speaker: st.speaker, rings: st.rings }, (now - t0) / 1000);
  };
  function tick(now: number) {
    raf = 0;
    if (now - drawnAt >= 1000 / FPS - 2) frame(now);
    if (st.interact) raf = requestAnimationFrame(tick);
  }
  const wake = () => {
    if (!raf && st.interact) raf = requestAnimationFrame(tick);
  };

  function onWorker(raw: unknown) {
    const m = asWorkerToTab(raw);
    if (!m) return;
    if (m.type === "unpin") {
      unpin(false);
      said.pin = "";
      return;
    }
    const was = st.interact;
    st = m;
    if (st.interact && !was) {
      host.style.visibility = "hidden"; // unseen until its place is read: no corner flash
      document.documentElement.append(host);
      frame(performance.now());
      void restorePlace().finally(() => (host.style.visibility = ""));
    } else if (!st.interact && was) leave();
    // eyes off closes gathering: pointer and selection go, a pin stays
    if (!st.eyes.on) for (const kind of ["pointer", "selection"] as const) if (said[kind]) say(kind, "");
    wake();
  }
  function connect() {
    if (!chrome.runtime?.id) return; // the extension was reloaded: this copy of the script is orphaned
    port = chrome.runtime.connect({ name: TAB_PORT });
    port.onMessage.addListener(onWorker);
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connect, 1000);
    });
  }
  const send = (m: TabToWorker) => {
    try {
      port?.postMessage(m);
    } catch (err) {
      console.info("BAUD: the worker is restarting", err);
    }
  };
  // a message every PING_MS keeps the worker, and with it the fleet poll, alive while this tab is open
  setInterval(() => send({ type: "ping" }), PING_MS);

  // Looking at: the element under the pointer, a selection, or the element the pulse is dropped on
  const said: Record<LookKind, string> = { pointer: "", selection: "", pin: "" };
  const say = (kind: LookKind, text: string) => {
    said[kind] = text;
    send({ type: "look", kind, text, title: pageTitle(document, location.host), page: pageId(location.href) });
  };
  let lookTimer = 0;
  let selTimer = 0;
  let pinTimer = 0;
  let drag: { x: number; y: number; ghost: HTMLDivElement | null } | null = null;
  let pinned: HTMLElement | null = null;
  let pinOutline: [string, string] = ["", ""];
  const outline = () => `2px solid ${tokens.green}`;

  addEventListener(
    "mousemove",
    (e) => {
      if (!st.interact) return;
      if (!st.eyes.on || drag || pinned) return;
      clearTimeout(lookTimer);
      lookTimer = window.setTimeout(() => {
        const text = what(document.elementsFromPoint(e.clientX, e.clientY).find((n) => n !== host), host);
        // an empty target clears the line: a pointer that left a heading must not keep naming it
        if (text !== said.pointer) say("pointer", text);
      }, CTX_WAIT);
    },
    { passive: true },
  );
  document.addEventListener("selectionchange", () => {
    if (!st.interact || !st.eyes.on) return;
    clearTimeout(selTimer);
    selTimer = window.setTimeout(() => {
      const s = getSelection();
      const text = s && !s.isCollapsed ? selectionText(s.toString()) : "";
      if (text !== said.selection) say("selection", text);
    }, CTX_WAIT);
  });
  // pinned, the line follows that element's text
  const pinWatch = new MutationObserver(() => {
    clearTimeout(pinTimer);
    pinTimer = window.setTimeout(() => pinned && say("pin", what(pinned, host)), CTX_WAIT);
  });
  function unpin(tell: boolean) {
    if (!pinned) return;
    pinned.style.outline = pinOutline[0];
    pinned.style.outlineOffset = pinOutline[1];
    pinned = null;
    pinWatch.disconnect();
    if (tell) say("pin", "");
  }
  function pin(node: HTMLElement) {
    unpin(false);
    const text = what(node, host);
    if (!text) {
      say("pin", "");
      return;
    }
    pinned = node;
    pinOutline = [node.style.outline, node.style.outlineOffset];
    node.style.outline = outline();
    node.style.outlineOffset = "2px";
    pinWatch.observe(node, { subtree: true, childList: true, characterData: true });
    say("pin", text);
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, ghost: null };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.ghost && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > PULSE_DRAG) {
      drag.ghost = el("div", { className: "ghost" });
      root.append(drag.ghost);
    }
    if (drag.ghost) Object.assign(drag.ghost.style, { left: `${e.clientX}px`, top: `${e.clientY}px` });
  });
  canvas.addEventListener("pointerup", (e) => {
    const d = drag;
    drag = null;
    if (!d?.ghost) return;
    d.ghost.remove();
    const node = document.elementFromPoint(e.clientX, e.clientY);
    if (node instanceof HTMLElement && node !== host && node !== document.body && node !== document.documentElement) pin(node);
    else unpin(true);
  });

  // off: the overlay leaves and this tab's lines go empty; the port stays
  function leave() {
    clearTimeout(lookTimer);
    clearTimeout(selTimer);
    clearTimeout(pinTimer);
    unpin(false);
    drag?.ghost?.remove();
    drag = null;
    for (const kind of Object.keys(said) as LookKind[]) if (said[kind]) say(kind, "");
    cancelAnimationFrame(raf);
    raf = 0;
    host.remove();
  }

  // ×: a click turns Interact off; held and dragged, it carries the whole overlay to where the pointer lets go
  const PLACE = placeKey(location.origin);
  let grip: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
  let dragged = false;
  close.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const r = host.getBoundingClientRect();
    grip = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
    close.setPointerCapture(e.pointerId);
  });
  close.addEventListener("pointermove", (e) => {
    if (!grip) return;
    if (!grip.moved && Math.hypot(e.clientX - grip.x, e.clientY - grip.y) > PULSE_DRAG) grip.moved = true;
    if (grip.moved) {
      Object.assign(host.style, { left: `${grip.left + e.clientX - grip.x}px`, top: `${grip.top + e.clientY - grip.y}px`, right: "auto" });
    }
  });
  close.addEventListener("pointerup", () => {
    dragged = !!grip?.moved;
    grip = null;
    if (!dragged || !chrome.runtime?.id) return;
    const r = host.getBoundingClientRect();
    chrome.storage.local.set({ [PLACE]: { left: r.left, top: r.top } }).catch((err) => console.info("BAUD: the place was not saved", err));
  });
  close.addEventListener("click", () => {
    if (dragged) {
      dragged = false;
      return;
    }
    st = { ...st, interact: false };
    leave();
    send({ type: "interact", on: false });
  });

  // kept as dropped, clamped on return so a smaller window never hides it
  function restorePlace(): Promise<void> {
    if (!chrome.runtime?.id) return Promise.resolve();
    return chrome.storage.local.get(PLACE).then(
      (v) => {
        const p = v[PLACE] as Place | undefined;
        if (!p) return;
        const r = host.getBoundingClientRect();
        const view = document.documentElement;
        const at = clampPlace(p, { width: view.clientWidth, height: view.clientHeight }, r);
        Object.assign(host.style, { left: `${at.left}px`, top: `${at.top}px`, right: "auto" });
      },
      (err) => console.info("BAUD: the place was not read", err),
    );
  }

  connect();
}

// an update orphans the old script but not its element, which carries the old name: drop it so a tab never shows two
document.querySelector("baud-orb")?.remove();
if (window.top === window && !document.querySelector("baud-pulse")) start();
