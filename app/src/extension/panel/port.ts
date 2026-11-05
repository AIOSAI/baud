/** The panel's port to the worker: reconnects when the worker sleeps, says hello on every connect, pings to keep it up. */

import { asWorkerToPanel, PANEL_PORT_PREFIX, PING_MS, type PanelToWorker, type WorkerToPanel } from "../messages";

export interface PanelLink {
  send(m: PanelToWorker): void;
}

export function connectPanel(onMessage: (m: WorkerToPanel) => void): PanelLink {
  let port: chrome.runtime.Port | null = null;
  const send = (m: PanelToWorker) => {
    try {
      port?.postMessage(m);
    } catch (err) {
      console.info("BAUD: the worker is restarting", err);
    }
  };
  function connect(windowId: number) {
    port = chrome.runtime.connect({ name: PANEL_PORT_PREFIX + windowId });
    port.onMessage.addListener((raw) => {
      const m = asWorkerToPanel(raw);
      if (m) onMessage(m);
    });
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(() => connect(windowId), 1000);
    });
    send({ type: "hello" }); // the worker answers with eyes, the current lines, the fleet and the Interact pill
  }
  void chrome.windows.getCurrent().then((w) => connect(w.id ?? -1));
  setInterval(() => send({ type: "ping" }), PING_MS);
  return { send };
}
