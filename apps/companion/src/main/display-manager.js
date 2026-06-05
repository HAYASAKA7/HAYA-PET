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
