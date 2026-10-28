import { describe, expect, it } from "vitest";

import { keyInputs, modifiersOf, mouseInput, neighbourOf, pagePoint, urlOf, wheelInput } from "./browserInput";

const none = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

describe("pagePoint", () => {
  it("scales the shown canvas to the page's CSS size, not the image's pixels", () => {
    const frame = { device_width: 1920, device_height: 1080 };
    expect(pagePoint(480, 270, 960, 540, frame)).toEqual({ x: 960, y: 540 });
    expect(pagePoint(0, 0, 960, 540, frame)).toEqual({ x: 0, y: 0 });
    expect(pagePoint(640, 360, 640, 360, frame)).toEqual({ x: 1920, y: 1080 });
  });
});

describe("modifiersOf", () => {
  it("uses CDP's bits: Alt 1, Ctrl 2, Meta 4, Shift 8", () => {
    expect(modifiersOf(none)).toBe(0);
    expect(modifiersOf({ ...none, altKey: true })).toBe(1);
    expect(modifiersOf({ ...none, ctrlKey: true, shiftKey: true })).toBe(10);
    expect(modifiersOf({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })).toBe(15);
  });
});

describe("mouseInput", () => {
  const at = { x: 10, y: 20 };
  it("names the button and counts clicks on press", () => {
    expect(mouseInput("mousePressed", { ...none, button: 2, buttons: 2, detail: 0 }, at).params).toEqual({
      type: "mousePressed",
      x: 10,
      y: 20,
      modifiers: 0,
      button: "right",
      buttons: 2,
      clickCount: 1,
    });
    expect(mouseInput("mousePressed", { ...none, button: 0, buttons: 1, detail: 2 }, at).params.clickCount).toBe(2);
  });

  it("carries the held button on a move, so a drag selects", () => {
    expect(mouseInput("mouseMoved", { ...none, button: 0, buttons: 1, detail: 0 }, at).params).toMatchObject({ button: "left", clickCount: 0 });
    expect(mouseInput("mouseMoved", { ...none, button: 0, buttons: 0, detail: 0 }, at).params.button).toBe("none");
  });

  it("turns line-mode wheel deltas into pixels", () => {
    expect(wheelInput({ ...none, deltaX: 0, deltaY: 3, deltaMode: 1 }, at).params).toMatchObject({ type: "mouseWheel", deltaY: 120 });
    expect(wheelInput({ ...none, deltaX: 5, deltaY: 53, deltaMode: 0 }, at).params).toMatchObject({ deltaX: 5, deltaY: 53 });
  });
});

describe("keyInputs", () => {
  const key = (key: string, code: string, keyCode: number, mods = none) => ({ ...mods, key, code, keyCode, repeat: false });

  it("sends printable text as a char after the keyDown", () => {
    const [down, char] = keyInputs("down", key("a", "KeyA", 65));
    expect(down.params).toMatchObject({ type: "keyDown", key: "a", windowsVirtualKeyCode: 65 });
    expect(down.params).not.toHaveProperty("text");
    expect(char.params).toMatchObject({ type: "char", text: "a", unmodifiedText: "a" });
  });

  it("gives Enter its carriage return and leaves control keys textless", () => {
    expect(keyInputs("down", key("Enter", "Enter", 13))[1].params.text).toBe("\r");
    expect(keyInputs("down", key("Backspace", "Backspace", 8))).toHaveLength(1);
    expect(keyInputs("down", key("ArrowLeft", "ArrowLeft", 37))).toHaveLength(1);
    expect(keyInputs("down", key("c", "KeyC", 67, { ...none, ctrlKey: true }))).toHaveLength(1);
  });

  it("releases with a keyUp", () => {
    expect(keyInputs("up", key("a", "KeyA", 65))).toEqual([
      { kind: "key", params: expect.objectContaining({ type: "keyUp", key: "a", modifiers: 0 }) },
    ]);
  });
});

describe("neighbourOf", () => {
  it("shows the tab that slides into the closed one's place, else the one before, else none", () => {
    expect(neighbourOf(["a", "b", "c"], "b")).toBe("c");
    expect(neighbourOf(["a", "b", "c"], "a")).toBe("b");
    expect(neighbourOf(["a", "b", "c"], "c")).toBe("b");
    expect(neighbourOf(["a"], "a")).toBeNull();
  });
});

describe("urlOf", () => {
  it("adds https to a bare host and keeps a named scheme", () => {
    expect(urlOf(" example.com/a ")).toBe("https://example.com/a");
    expect(urlOf("http://localhost:3000")).toBe("http://localhost:3000");
    expect(urlOf("about:blank")).toBe("about:blank");
  });
});
