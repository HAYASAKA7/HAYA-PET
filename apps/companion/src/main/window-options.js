const DEFAULT_BOUNDS = Object.freeze({
  width: 192,
  height: 208
});

export function buildPetWindowOptions({ capabilities, bounds = DEFAULT_BOUNDS } = {}) {
  const overlaySupported = capabilities?.transparentOverlay === "required";
  const overlayMode = overlaySupported ? "transparent-overlay" : "fallback-window";

  return {
    overlayMode,
    browserWindow: overlaySupported
      ? buildTransparentOverlayOptions(bounds)
      : buildFallbackWindowOptions(bounds)
  };
}

function buildTransparentOverlayOptions(bounds) {
  return {
    ...normalizeBounds(bounds),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    backgroundColor: "#00000000"
  };
}

function buildFallbackWindowOptions(bounds) {
  return {
    ...normalizeBounds(bounds),
    transparent: false,
    frame: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    hasShadow: true,
    focusable: true,
    backgroundColor: "#ffffff"
  };
}

function normalizeBounds(bounds) {
  const normalized = {
    width: bounds.width ?? DEFAULT_BOUNDS.width,
    height: bounds.height ?? DEFAULT_BOUNDS.height
  };

  if (Number.isFinite(bounds.x)) {
    normalized.x = bounds.x;
  }

  if (Number.isFinite(bounds.y)) {
    normalized.y = bounds.y;
  }

  return normalized;
}
