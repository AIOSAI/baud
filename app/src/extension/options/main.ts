/** The options page: the host and a one-use pairing code redeemed for a token, the origin permission, and a roster test. */

import { agentRoster } from "../../host";
import { configureHost, redeemPairing } from "../../host/transport.http";
import { loadHost, normalizeBase, originPattern, readHost, saveHost } from "../lib/hostConfig";
import "../../tokens/tokens.generated.css";
import "../extension.css";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const base = $<HTMLInputElement>("base");
const code = $<HTMLInputElement>("code");
const said = $<HTMLParagraphElement>("said");

function say(text: string, tone: "ok" | "bad" | "" = "") {
  said.textContent = text;
  said.dataset.tone = tone;
}

/** Chrome lets an extension page skip CORS only for an origin it holds; asked inside the click, as Chrome requires. */
async function permitted(b: string): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: [originPattern(b)] });
  } catch (err) {
    say(`the permission request failed: ${String(err)}`, "bad");
    return false;
  }
}

$<HTMLButtonElement>("pair").addEventListener("click", async () => {
  const b = normalizeBase(base.value);
  if (!b) return say("the host must be an http(s) address, like http://127.0.0.1:8787", "bad");
  const c = code.value.trim();
  if (!c) return say("paste the pairing code `drone @api host-api pair extension` printed", "bad");
  if (!(await permitted(b))) return say(`not paired: access to ${b} was not granted`, "bad");
  say("pairing …");
  configureHost(b, null);
  try {
    const paired = await redeemPairing(c);
    await saveHost({ base: b, token: paired.token });
    base.value = b;
    code.value = "";
    say(`paired as ${paired.label || "extension"} (${paired.scope})`, "ok");
  } catch (err) {
    void readHost(); // a failed pairing leaves the saved host as it was
    say(err instanceof Error ? err.message : String(err), "bad");
  }
});

$<HTMLButtonElement>("test").addEventListener("click", async () => {
  const saved = await readHost();
  if (!saved) return say("not paired yet", "bad");
  say("asking GET /v1/roster …");
  try {
    const rows = await agentRoster();
    say(`ok - ${rows.length} working agents across projects`, "ok");
  } catch (err) {
    say(err instanceof Error ? err.message : String(err), "bad");
  }
});

void loadHost().then((s) => {
  if (s) base.value = s.base;
});
