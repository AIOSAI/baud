/** The header lock chip's lane: whether the laptop's screen is locked. Reference: docs/phone/wheel.md */

import { useCallback, useEffect, useRef, useState } from "react";

import { lockState } from "../../host";
import { HostError } from "../../host/transport.http";
import type { LockState } from "../../types";
import { whileVisible } from "./whileVisible";

export const LOCK_POLL_MS = 5_000;

/** `loginctl lock-session` returns before the screen locks, so the tap reads again this much later. */
export const LOCK_SETTLE_MS = 1_000;

/** Both null: nothing has answered yet. */
export interface LockRead {
  state: LockState | null;
  failure: string | null;
}

const NOT_READ: LockRead = { state: null, failure: null };

export function useLockState(): { read: LockRead; reread: () => void } {
  const [read, setRead] = useState<LockRead>(NOT_READ);
  const tickRef = useRef<(() => void) | null>(null);
  const settle = useRef(0);

  useEffect(() => {
    let live = true;
    let busy = false;
    let again = false;

    const tick = async () => {
      // Queued, not dropped: a poll that left before the tap would otherwise be the last word.
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        const state = await lockState();
        if (live) setRead({ state, failure: null });
      } catch (cause) {
        if (live) {
          setRead({ state: null, failure: cause instanceof HostError || cause instanceof Error ? cause.message : String(cause) });
        }
      } finally {
        busy = false;
        if (again && live) {
          again = false;
          void tick();
        }
      }
    };
    tickRef.current = () => void tick();

    // Hidden forgets the reading, so "did I lock it" never sees a green from before the pocket.
    const onVisibility = () => {
      if (document.visibilityState !== "visible") setRead(NOT_READ);
    };
    document.addEventListener("visibilitychange", onVisibility);
    const stop = whileVisible(() => void tick(), LOCK_POLL_MS);

    return () => {
      live = false;
      tickRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearTimeout(settle.current);
      stop();
    };
  }, []);

  const reread = useCallback(() => {
    tickRef.current?.();
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => tickRef.current?.(), LOCK_SETTLE_MS);
  }, []);

  return { read, reread };
}

// Unknown is never unlocked: a green shackle is a claim, and only a reading makes it.
export type LockFace = "unread" | "unlocked" | "locked" | "unknown";

export function lockFace({ state, failure }: LockRead): LockFace {
  if (failure !== null) return "unknown";
  if (state === null) return "unread";
  if (state.ok && state.locked === true) return "locked";
  if (state.ok && state.locked === false) return "unlocked";
  return "unknown";
}

export function lockLine({ state, failure }: LockRead): string | null {
  if (failure !== null) return `lock state unknown - ${failure}`;
  if (state === null) return null;
  if (state.detail) return state.detail;
  if (state.ok && state.locked !== null) return state.locked ? "the screen is locked" : "the screen is unlocked";
  return `lock state unknown${state.reason ? ` (${state.reason})` : ""}`;
}
