/**
 * A repeating tick that only runs while somebody is looking (DPLAN-0305).
 *
 * WHAT THIS FIXES, MEASURED BY @devpulse's AUDIT RATHER THAN GUESSED: four
 * app-lifetime pollers at the top of `PhoneApp` were producing about 30.5
 * requests a minute on EVERY screen, phone in a pocket included. The host
 * serves those on a single event loop with blocking work in the handlers, so a
 * request the operator will never see is not free anywhere - it is a slice of
 * the loop that the terminal websocket does not get.
 *
 * THE BROWSER'S OWN THROTTLE IS NOT THIS. A hidden tab's timers are slowed to
 * about once a minute, and that is a courtesy, not a contract: it is
 * per-browser, it does not apply to an installed PWA the same way everywhere,
 * and a slowed poll is still a poll. Slowed is not stopped.
 *
 * VISIBLE MEANS ONE IMMEDIATE TICK, and that is the half that makes this safe
 * to apply everywhere. A gate that only paused would hand the operator a wheel
 * frozen at the moment they pocketed the phone; waking with a tick means what
 * they see when they look is what is true when they look, which is strictly
 * fresher than the old behaviour at the same instant.
 *
 * The idiom is `TerminalSheet`'s, generalised. That sheet already re-attaches
 * its socket on `visibilitychange` for the same reason in reverse - the
 * platform closes sockets behind a backgrounded PWA - and this is the polling
 * half of the same sentence.
 */

/**
 * Start a visibility-gated interval and answer with its teardown.
 *
 * NOT A HOOK, deliberately. Each caller has its own dependencies, its own
 * guards and its own reason to rebuild, and a hook would have had to take all
 * of that as arguments. A plain function returning a teardown drops into an
 * existing `useEffect` as its return value and changes nothing else about it.
 *
 * THE FIRST TICK IS THIS FUNCTION'S, not the caller's. Every one of these
 * lanes used to fire once before setting its interval, and that call has moved
 * in here - so a lane that starts life hidden asks for nothing at all, rather
 * than paying for one full sweep into a screen nobody is looking at.
 *
 * Args:
 *   tick: The work. Called immediately when visible, then every `everyMs`.
 *     Errors are the caller's to handle - this is a clock, not a lane.
 *   everyMs: The spacing, unchanged from whatever the caller used before.
 *
 * Returns:
 *   The teardown. Call it from the effect's cleanup - it stops the interval
 *   and drops the listener, in that order.
 */
export function whileVisible(tick: () => void, everyMs: number): () => void {
  let timer = 0;

  const start = () => {
    // Already running - a second `visible` event (they do arrive) must not
    // stack a second interval on top of the first.
    if (timer) return;
    tick();
    timer = window.setInterval(tick, everyMs);
  };

  const stop = () => {
    if (!timer) return;
    window.clearInterval(timer);
    timer = 0;
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible") start();
    else stop();
  };

  onVisibility();
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    stop();
  };
}
