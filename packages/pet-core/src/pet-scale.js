// Pure math for the pet resize grip: the user drags the pet's bottom-right
// corner to scale the sprite between MIN_SCALE and MAX_SCALE, aspect locked.

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2;
export const DEFAULT_SCALE = 1;

export function clampScale(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_SCALE;
  }

  return Math.min(Math.max(value, MIN_SCALE), MAX_SCALE);
}

// Maps a grip drag to the next scale: each axis implies a scale from how far
// the pointer moved relative to the pet's base size, and the two are averaged
// so the pet follows the pointer along the diagonal while staying aspect-locked.
export function resolveScaleFromDrag({ startScale, startPointer, pointer, baseSize } = {}) {
  const safeStart = clampScale(startScale);

  if (
    !Number.isFinite(startPointer?.x) || !Number.isFinite(startPointer?.y) ||
    !Number.isFinite(pointer?.x) || !Number.isFinite(pointer?.y) ||
    !Number.isFinite(baseSize?.width) || !Number.isFinite(baseSize?.height) ||
    baseSize.width <= 0 || baseSize.height <= 0
  ) {
    return safeStart;
  }

  const scaleX = safeStart + (pointer.x - startPointer.x) / baseSize.width;
  const scaleY = safeStart + (pointer.y - startPointer.y) / baseSize.height;
  return clampScale((scaleX + scaleY) / 2);
}
