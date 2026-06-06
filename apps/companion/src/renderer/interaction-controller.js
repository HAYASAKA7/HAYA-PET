const DEFAULT_DRAG_THRESHOLD = 6;
const DEFAULT_CLICK_MAX_DURATION = 300;
const DEFAULT_DOUBLE_CLICK_WINDOW = 350;

// Distinguishes click / double-click / drag from raw pointer events.
//
// - Drag is reported synchronously from pointerMove/pointerUp so window movement
//   stays responsive, and its direction is derived from the *incremental*
//   movement (last point -> current point) so left/right flips the instant the
//   user reverses, instead of waiting to cancel out the cumulative offset.
// - Click is *deferred* by the double-click window and delivered via onAction;
//   if a second click lands first, the pending single click is cancelled so a
//   double click never also fires a wave. Timers are injectable for testing.
export function createInteractionController(options = {}) {
  const dragThreshold = options.dragThreshold ?? DEFAULT_DRAG_THRESHOLD;
  const clickMaxDuration = options.clickMaxDuration ?? DEFAULT_CLICK_MAX_DURATION;
  const doubleClickWindow = options.doubleClickWindow ?? DEFAULT_DOUBLE_CLICK_WINDOW;
  const onAction = options.onAction ?? (() => {});
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id));

  let pointerStart;
  let lastPoint;
  let dragging = false;
  let lastDirection;
  let pendingClickTimer;

  function cancelPendingClick() {
    if (pendingClickTimer !== undefined) {
      clearTimer(pendingClickTimer);
      pendingClickTimer = undefined;
    }
  }

  return {
    pointerDown(point) {
      pointerStart = point;
      lastPoint = point;
      dragging = false;
      lastDirection = undefined;
    },

    pointerMove(point) {
      if (!pointerStart) {
        return undefined;
      }

      const totalDx = point.x - pointerStart.x;
      const totalDy = point.y - pointerStart.y;

      if (!dragging && distance(totalDx, totalDy) <= dragThreshold) {
        return undefined;
      }

      dragging = true;

      const incrementalDx = point.x - lastPoint.x;
      lastPoint = point;

      let direction = lastDirection;
      if (incrementalDx < 0) {
        direction = "left";
      } else if (incrementalDx > 0) {
        direction = "right";
      } else if (!direction) {
        direction = totalDx < 0 ? "left" : "right";
      }
      lastDirection = direction;

      return {
        type: "drag",
        direction,
        action: direction === "left" ? "running-left" : "running-right"
      };
    },

    pointerUp(point) {
      if (!pointerStart) {
        return undefined;
      }

      const startedAt = pointerStart;
      pointerStart = undefined;

      if (dragging) {
        dragging = false;
        return { type: "drag-end" };
      }

      const duration = point.time - startedAt.time;
      if (duration > clickMaxDuration) {
        return undefined;
      }

      if (pendingClickTimer !== undefined) {
        // Second click within the window -> double click; drop the pending single.
        cancelPendingClick();
        onAction({ type: "double-click", action: "jumping" });
        return undefined;
      }

      pendingClickTimer = setTimer(() => {
        pendingClickTimer = undefined;
        onAction({ type: "click", action: "waving" });
      }, doubleClickWindow);

      return undefined;
    }
  };
}

function distance(x, y) {
  return Math.sqrt(x * x + y * y);
}
