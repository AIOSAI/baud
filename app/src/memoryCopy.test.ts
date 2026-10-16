import { describe, expect, it } from "vitest";

import { CAPS_AT_DESKTOP, capsLine, enforcementWarns, pushScope } from "./memoryCopy";

describe("capsLine", () => {
  it("says the caps are set at the desktop on a face with no caps lane and no caps", () => {
    expect(capsLine(0, true)).toBe("desktop");
  });

  it("keeps the hook sentence on the desktop even when its caps list is empty", () => {
    expect(capsLine(0, false)).toBe("hook");
  });

  it("keeps the hook sentence over real caps on either face", () => {
    expect(capsLine(3, false)).toBe("hook");
    expect(capsLine(1, true)).toBe("hook");
  });

  it("words the desktop line exactly as ruled", () => {
    expect(CAPS_AT_DESKTOP).toBe("character caps are set at the desktop");
  });
});

describe("enforcementWarns", () => {
  it("warns on an enforcement flag read as false", () => {
    expect(enforcementWarns(false)).toBe(true);
  });

  it("stays quiet when enforcement is on", () => {
    expect(enforcementWarns(true)).toBe(false);
  });

  it("stays quiet when enforcement is unknown, which is not an alarm", () => {
    expect(enforcementWarns(null)).toBe(false);
  });
});

describe("pushScope", () => {
  it("says every branch when no branch has an override, never a guessed 17", () => {
    expect(pushScope(0)).toBe("every branch");
  });

  it("still says every branch with overrides, and counts the ones that lose their own limits", () => {
    expect(pushScope(3)).toBe("every branch, 3 with their own limits");
    expect(pushScope(1)).toBe("every branch, one with its own limits");
  });
});
