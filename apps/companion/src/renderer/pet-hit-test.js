// Pure helpers for the pet's pixel-precise click-through. The browser glue in
// pet-window.js supplies the live pixel alpha and the canvas bounding box; these
// functions hold the (testable) decisions.

// Default minimum alpha for a pixel to count as "the pet" rather than the
// transparent margin of its sprite cell. A small threshold ignores faint
// anti-aliased edges so the click-through hugs the visible silhouette.
export const DEFAULT_ALPHA_THRESHOLD = 16;

// Top-left inclusive, bottom-right exclusive — matches canvas pixel indexing so
// the same predicate works for both bounding-box and per-pixel tests.
export function isPointInsideRect(point, rect) {
  return (
    point.x >= rect.left &&
    point.x < rect.right &&
    point.y >= rect.top &&
    point.y < rect.bottom
  );
}

export function isOpaqueAlpha(alpha, threshold = DEFAULT_ALPHA_THRESHOLD) {
  return alpha >= threshold;
}
