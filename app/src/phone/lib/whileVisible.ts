/** A repeating tick that runs only while the screen is visible, ticking at once on return. Reference: docs/phone.md */

export function whileVisible(tick: () => void, everyMs: number): () => void {
  let timer = 0;

  const start = () => {
    // A second `visible` event does arrive; it must not stack a second interval.
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
