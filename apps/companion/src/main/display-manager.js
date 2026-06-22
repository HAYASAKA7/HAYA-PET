const DEFAULT_SIZE = Object.freeze({
  width: 192,
  height: 208
});

export function resolveSavedPosition(savedPosition, displays, size = DEFAULT_SIZE) {
  const display = findDisplayForSavedPosition(savedPosition, displays);
  const windowBounds = savedPosition
    ? {
        x: savedPosition.x,
        y: savedPosition.y,
        width: savedPosition.width ?? size.width,
        height: savedPosition.height ?? size.height
      }
    : defaultBoundsForDisplay(display, size);
  const clamped = clampWindowBounds(windowBounds, display);

  return {
    ...clamped,
    displayId: display.id,
    scaleFactor: display.scaleFactor ?? 1
  };
}

// Resolve where the overlay window should sit RIGHT NOW: which display's work
// area it spans, plus where the pet sprite sits inside it (work-area-relative).
// Shared by initial placement and by re-homing after a display change (monitor
// unplugged, resolution/DPI change, dock/undock, sleep→resume). Re-homing is what
// stops the overlay from being stranded off-screen on a display that no longer
// exists — the bug where the pet "vanishes" but the process is alive and neither
// Show/Hide nor Reset (which only move the sprite inside the window) recover it.
export function resolveOverlayPlacement({ savedPosition, displays, petSize = DEFAULT_SIZE } = {}) {
  const saved = resolveSavedPosition(savedPosition, displays, petSize);
  // saved.displayId always names a display that currently exists (resolveSavedPosition
  // falls back to primary/first when the saved one is gone), so this re-homes a
  // stranded position onto a valid display.
  const display = findDisplayForSavedPosition({ displayId: saved.displayId }, displays);
  const workArea = display.workArea ?? display.bounds;
  const petLocal = clampLocalToWorkArea(
    { x: saved.x - workArea.x, y: saved.y - workArea.y },
    workArea,
    petSize
  );

  return { workArea, displayId: display.id, petLocal };
}

// Keep a pet's work-area-relative position inside the work area for a given pet
// size. Pure mirror of the companion's in-window clamp, so placement resolution
// can be unit-tested without Electron.
export function clampLocalToWorkArea(local, workArea, petSize = DEFAULT_SIZE) {
  const maxX = Math.max(0, (workArea?.width ?? petSize.width) - petSize.width);
  const maxY = Math.max(0, (workArea?.height ?? petSize.height) - petSize.height);
  return {
    x: clamp(local?.x ?? 0, 0, maxX),
    y: clamp(local?.y ?? 0, 0, maxY)
  };
}

export function clampWindowBounds(bounds, display) {
  const workArea = display.workArea ?? display.bounds;
  const width = bounds.width ?? DEFAULT_SIZE.width;
  const height = bounds.height ?? DEFAULT_SIZE.height;
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;

  return {
    x: clamp(bounds.x ?? workArea.x, workArea.x, maxX),
    y: clamp(bounds.y ?? workArea.y, workArea.y, maxY),
    width,
    height
  };
}

function findDisplayForSavedPosition(savedPosition, displays) {
  if (!Array.isArray(displays) || displays.length === 0) {
    throw new Error("At least one display is required");
  }

  if (savedPosition?.displayId) {
    const savedDisplay = displays.find((display) => display.id === savedPosition.displayId);
    if (savedDisplay) {
      return savedDisplay;
    }
  }

  return displays.find((display) => display.primary) ?? displays[0];
}

function defaultBoundsForDisplay(display, size) {
  const workArea = display.workArea ?? display.bounds;
  return {
    x: workArea.x + workArea.width - size.width,
    y: workArea.y + workArea.height - size.height,
    width: size.width,
    height: size.height
  };
}

function clamp(value, min, max) {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}
