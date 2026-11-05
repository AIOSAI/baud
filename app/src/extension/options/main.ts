/** The options page: host address and token into chrome.storage.local, the origin permission, and a fleet test. */

import { fleetSnapshot } from "../../host";
import { configureHost } from "../../host/transport.http";
import { loadHost, normalizeBase, originPattern, readHost, saveHost } from "../lib/hostConfig";
import "../../tokens/tokens.generated.css";
import "../extension.css";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const base = $<HTMLInputElement>("base");
const token = $<HTMLInputElement>("token");
const said = $<HTMLParagraphElement>("said");

function say(text: string, tone: "ok" | "bad" | "" = "") {
  said.textContent = text;
  said.dataset.tone = tone;
}

/** The fields as typed, or a sentence saying what is wrong with them. */
function fields(): { base: string; token: string } | string {
  const b = normalizeBase(base.value);
  if (!b) return "the host address must be an http(s) address, like http://127.0.0.1:8787";
  const t = token.value.trim();
  if (!t) return "paste the token `drone @api host-api pair extension` printed";
  return { base: b, token: t };
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

$<HTMLButtonElement>("save").addEventListener("click", async () => {
  const f = fields();
  if (typeof f === "string") return say(f, "bad");
  if (!(await permitted(f.base))) return say(`not saved: access to ${f.base} was not granted`, "bad");
  await saveHost(f);
  base.value = f.base;
  say("saved", "ok");
});

$<HTMLButtonElement>("test").addEventListener("click", async () => {
  const f = fields();
  if (typeof f === "string") return say(f, "bad");
  if (!(await permitted(f.base))) return say(`access to ${f.base} was not granted`, "bad");
  say("asking GET /v1/fleet …");
  configureHost(f.base, f.token);
  try {
    const snap = await fleetSnapshot();
    say(`ok - ${snap.branches?.length ?? 0} agents in ${snap.project || "the seated project"}`, "ok");
  } catch (err) {
    say(err instanceof Error ? err.message : String(err), "bad");
  } finally {
    void readHost(); // back to what is saved, so an unsaved test never becomes the page's token
  }
});

void loadHost().then((s) => {
  if (!s) return;
  base.value = s.base;
  token.value = s.token;
});
