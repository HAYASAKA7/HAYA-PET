const DEFAULT_DRAG_THRESHOLD = 6;
const DEFAULT_CLICK_MAX_DURATION = 300;
const DEFAULT_DOUBLE_CLICK_WINDOW = 350;

export function createInteractionController(options = {}) {
  const dragThreshold = options.dragThreshold ?? DEFAULT_DRAG_THRESHOLD;
  const clickMaxDuration = options.clickMaxDuration ?? DEFAULT_CLICK_MAX_DURATION;
  const doubleClickWindow = options.doubleClickWindow ?? DEFAULT_DOUBLE_CLICK_WINDOW;

  let pointerStart;
  let dragging = false;
  let lastClickAt;

  return {
    pointerDown(point) {
      pointerStart = point;
      dragging = false;
      return undefined;
    },

    pointerMove(point) {
      if (!pointerStart) {
        return undefined;
      }

      const deltaX = point.x - pointerStart.x;
      const deltaY = point.y - pointerStart.y;
      if (!dragging && distance(deltaX, deltaY) <= dragThreshold) {
        return undefined;
      }

      dragging = true;
      const direction = deltaX < 0 ? "left" : "right";

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

      if (Number.isFinite(lastClickAt) && point.time - lastClickAt <= doubleClickWindow) {
        lastClickAt = undefined;
        return {
          type: "double-click",
          action: "jumping"
        };
      }

      lastClickAt = point.time;
      return {
        type: "click",
        action: "waving"
      };
    }
  };
}

function distance(x, y) {
  return Math.sqrt(x * x + y * y);
}
