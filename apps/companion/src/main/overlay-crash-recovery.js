// Pure policy for recovering the overlay window after a GPU or renderer process
// crash. Chromium's GPU/renderer process can die under heavy load — e.g. a local
// image-generation run pushing the GPU into a TDR reset or exhausting VRAM. When
// it does, a transparent always-on-top overlay stops painting and goes invisible
// while the main process, tray, and daemon stay alive (the "running but I can't
// see it" report). Re-asserting the window bounds does NOT repaint a dead surface
// (verified in the field: "Reset Position" did not bring it back), so recovery
// has to recreate the window — but a window that crashes straight back on
// recreation would spin, so this caps consecutive recreations that never manage a
// successful load.
//
// Time-free by design (no timers, matching the project's no-timer rule): the
// counter resets whenever a load finishes, so independent crashes always recover
// and only a genuine crash -> recreate -> crash loop escalates to "give up".
export function createOverlayCrashPolicy({ maxConsecutive = 3 } = {}) {
  let count = 0;

  return {
    // Call on each crash. Returns true to attempt recovery, or false once we've
    // hit the consecutive cap with no successful load in between (stop the spin).
    shouldRecover() {
      if (count >= maxConsecutive) {
        return false;
      }
      count += 1;
      return true;
    },

    // Call when a (re)load finishes successfully — recovery worked, so reset.
    markRecovered() {
      count = 0;
    },

    get consecutiveFailures() {
      return count;
    }
  };
}
