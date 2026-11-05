/* The service worker: the one place that reads the host for the tabs (a content script runs under the page's
   origin), the relay between a tab's orb and the side panel, and the panel's opener. */

import { agentRoster } from "../host";
import { loadHost } from "./lib/hostConfig";
import { orbMode, ringsOf } from "./lib/orbState";
import { TabBook } from "./lib/tabBook";
import {
  DEFAULT_EYES,
  PANEL_PORT_PREFIX,
  TAB_PORT,
  asEyes,
  asPanelToWorker,
  asTabToWorker,
  isPanelSender,
  isTabSender,
  type Eyes,
  type FleetEntry,
  type LookAt,
  type OrbInputs,
  type WorkerToPanel,
  type WorkerToTab,
} from "./messages";

const FRAME_MS = 1000 / 15;
const FLEET_MS = 5000;

type Port = chrome.runtime.Port;
const book = new TabBook();
const tabs = new Set<Port>();
const panels = new Map<number, Port>();
/** Per window: the agent tab open in its panel, and what the panel last said about it. */
const seats = new Map<number, { agent: string | null; inputs: OrbInputs | null }>();
let eyes: Eyes = DEFAULT_EYES;
let branches: FleetEntry[] = [];
let fleetError: string | null = null;
let fleetTimer: ReturnType<typeof setInterval> | 0 = 0;
let ready = false;
let pending: ReturnType<typeof setTimeout> | 0 = 0;
let sentAt = 0;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => console.warn("side panel behaviour", err));

// Nothing is pushed until the stored hue is known, so a waking worker never paints the default hue first.
Promise.all([
  chrome.storage.local.get("eyes").then((v) => {
    eyes = asEyes(v.eyes) ?? DEFAULT_EYES;
  }),
  loadHost(() => void readFleet()),
]).finally(() => {
  ready = true;
  push();
  fleetWanted();
});

const tabOf = (port: Port) => port.sender!.tab!;
const portsOf = (tabId: number) => [...tabs].filter((p) => tabOf(p).id === tabId);
const toTab = (port: Port, m: WorkerToTab) => port.postMessage(m);
const toPanel = (windowId: number, m: WorkerToPanel) => panels.get(windowId)?.postMessage(m);

function stateFor(port: Port): WorkerToTab {
  const tab = tabOf(port);
  const seat = seats.get(tab.windowId);
  const { mode, speaker } = orbMode(seat?.agent ?? null, branches, seat?.inputs ?? null);
  return { type: "state", mode, speaker, eyes, interact: book.isOn(tab.id!), rings: ringsOf(branches) };
}

function push(windowId?: number) {
  if (!ready) return;
  for (const p of tabs) if (windowId === undefined || tabOf(p).windowId === windowId) toTab(p, stateFor(p));
}

// loudness arrives up to 25 times a second; the orbs draw at 15, so they hear it no faster
function pushSoon() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = 0;
    sentAt = Date.now();
    push();
  }, Math.max(0, sentAt + FRAME_MS - Date.now()));
}

async function readFleet() {
  try {
    const next = (await agentRoster()) as FleetEntry[];
    fleetError = null;
    if (JSON.stringify(next) !== JSON.stringify(branches)) {
      branches = next;
      push();
    }
  } catch (err) {
    fleetError = err instanceof Error ? err.message : String(err); // the last dots stay: a blip must not empty the rings
  }
  for (const id of panels.keys()) toPanel(id, { type: "fleet", branches, error: fleetError });
}

/** The fleet is read while an orb shows it or a panel lists it, never otherwise. */
function fleetWanted() {
  const want = ready && (book.anyOn || panels.size > 0);
  if (want && !fleetTimer) {
    fleetTimer = setInterval(() => void readFleet(), FLEET_MS);
    void readFleet();
  } else if (!want && fleetTimer) {
    clearInterval(fleetTimer);
    fleetTimer = 0;
  }
}

/** The panel's Interact pill shows its window's active tab; `can` is false where no content script answers. */
async function tellPanel(windowId: number) {
  if (!panels.has(windowId)) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  const can = tab?.id !== undefined && portsOf(tab.id).length > 0;
  toPanel(windowId, { type: "interact", on: can && book.isOn(tab!.id!), can });
}
const tellPanelSoon = (windowId: number) => tellPanel(windowId).catch((err) => console.info("the Interact pill", err));

function sendLooks(windowId: number, looks: LookAt[]) {
  for (const look of looks) toPanel(windowId, { type: "look", look });
}

function setInteract(tabId: number, windowId: number, on: boolean) {
  if (on !== book.isOn(tabId)) book.toggle(tabId, true);
  if (!on) sendLooks(windowId, book.gone(windowId, tabId));
  fleetWanted();
  for (const p of portsOf(tabId)) toTab(p, stateFor(p));
  void tellPanelSoon(windowId);
}

async function toggleActive(windowId: number) {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab?.id !== undefined && portsOf(tab.id).length) setInteract(tab.id, windowId, !book.isOn(tab.id));
  else await tellPanel(windowId);
}

function addTab(port: Port) {
  const { id: tabId, windowId } = tabOf(port) as { id: number; windowId: number };
  tabs.add(port);
  port.onDisconnect.addListener(() => {
    tabs.delete(port);
    if (!portsOf(tabId).length) {
      sendLooks(windowId, book.gone(windowId, tabId));
      fleetWanted();
    }
    void tellPanelSoon(windowId);
  });
  port.onMessage.addListener((raw) => {
    const m = asTabToWorker(raw);
    if (!m) return;
    if (m.type === "interact") setInteract(tabId, windowId, false);
    if (m.type !== "look") return;
    const look: LookAt = { kind: m.kind, text: m.text, title: m.title, page: m.page, pinned: m.kind === "pin" };
    if (!book.look(windowId, tabId, look)) return;
    toPanel(windowId, { type: "look", look });
    // one pin per window
    if (look.pinned && look.text) for (const p of tabs) if (p !== port && tabOf(p).windowId === windowId) toTab(p, { type: "unpin" });
  });
  if (ready) toTab(port, stateFor(port));
  void tellPanelSoon(windowId);
}

function addPanel(port: Port, windowId: number) {
  panels.get(windowId)?.disconnect();
  panels.set(windowId, port);
  fleetWanted();
  port.onDisconnect.addListener(() => {
    if (panels.get(windowId) !== port) return;
    panels.delete(windowId);
    const seat = seats.get(windowId);
    if (seat) seat.inputs = null; // the agent stays: the fleet's busy still drives the orb with the panel closed
    fleetWanted();
    push(windowId);
  });
  port.onMessage.addListener((raw) => {
    const m = asPanelToWorker(raw);
    if (!m) return;
    switch (m.type) {
      case "hello":
        toPanel(windowId, { type: "eyes", eyes });
        sendLooks(windowId, book.current(windowId));
        toPanel(windowId, { type: "fleet", branches, error: fleetError });
        void tellPanelSoon(windowId);
        return;
      case "agent":
        seats.set(windowId, { agent: m.agent, inputs: null });
        push(windowId);
        return;
      case "orb": {
        const { type: _type, ...inputs } = m;
        seats.set(windowId, { agent: seats.get(windowId)?.agent ?? null, inputs });
        pushSoon();
        return;
      }
      case "eyes":
        eyes = { on: m.on, hue: m.hue };
        void chrome.storage.local.set({ eyes });
        push();
        for (const id of panels.keys()) if (id !== windowId) toPanel(id, { type: "eyes", eyes });
        return;
      case "unpin":
        sendLooks(windowId, book.drop(windowId, "pin"));
        for (const p of tabs) if (tabOf(p).windowId === windowId) toTab(p, { type: "unpin" });
        return;
      case "interact":
        void (m.toggle ? toggleActive(windowId) : tellPanel(windowId)).catch((err) => console.info("the Interact pill", err));
        return;
    }
  });
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  sendLooks(windowId, book.activated(windowId, tabId));
  void tellPanelSoon(windowId);
});

chrome.runtime.onConnect.addListener((port) => {
  const from = port.sender;
  if (port.name === TAB_PORT && isTabSender(from, chrome.runtime.id)) addTab(port);
  else if (
    port.name.startsWith(PANEL_PORT_PREFIX) &&
    isPanelSender(from, chrome.runtime.id, chrome.runtime.getURL("sidepanel.html")) &&
    Number.isInteger(Number(port.name.slice(PANEL_PORT_PREFIX.length)))
  )
    addPanel(port, Number(port.name.slice(PANEL_PORT_PREFIX.length)));
  else port.disconnect();
});
