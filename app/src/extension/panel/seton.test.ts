// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";

/** Seton as the side panel loads it: the adapter, then the vendored script, against the panel's own markup. */

let composer: HTMLTextAreaElement;
const chip = () => document.querySelector<HTMLButtonElement>(".seton-chip")!;
const box = () => document.querySelector<HTMLDivElement>(".seton-box")!;

function select(node: Node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new MouseEvent("mouseup"));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(async () => {
  document.body.innerHTML = `
    <div class="baud-ext-feed">
      <div class="baud-ext-line baud-ext-user"><small>you</small><div class="baud-ext-text">my own words</div></div>
      <div class="baud-ext-line baud-ext-tool"><small>tool</small><div class="baud-ext-text">ran: ls</div></div>
      <div class="baud-ext-line baud-ext-agent"><small>devpulse</small><div class="baud-ext-md"><p>the plan ships today</p></div></div>
    </div>
    <form class="baud-ext-ask"><textarea>draft</textarea></form>`;
  composer = document.querySelector("textarea")!;
  // jsdom has no layout: Seton only needs a rectangle and the pointer query.
  Range.prototype.getBoundingClientRect = () => ({ left: 10, top: 40 }) as DOMRect;
  window.matchMedia = () => ({ matches: false }) as MediaQueryList;
  await import("./setonSite");
  // @ts-expect-error: vendored plain JS with no types, loaded for its side effects
  await import("../vendor/seton/seton.js");
});

describe("Seton in the side panel", () => {
  it("offers Reply on an agent reply and appends the quote and answer to the composer, unsent", async () => {
    select(document.querySelector(".baud-ext-agent p")!);
    await settle();
    expect(chip().hidden).toBe(false);

    chip().click();
    const input = box().querySelector("textarea")!;
    input.value = "good, then tag it";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(composer.value).toBe("draft> the plan ships today\n\n↳ good, then tag it\n\n");
    expect(box().hidden).toBe(true);
  });

  it("offers nothing on your own line, a tool row, a reply's label or the composer", async () => {
    for (const node of [
      document.querySelector(".baud-ext-user .baud-ext-text")!,
      document.querySelector(".baud-ext-tool .baud-ext-text")!,
      document.querySelector(".baud-ext-agent small")!,
      composer,
    ]) {
      chip().hidden = true;
      select(node);
      await settle();
      expect(chip().hidden).toBe(true);
    }
  });
});
